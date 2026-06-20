import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  mergeRubberbandingChangedFiles,
  resolveRubberbandingCoverageInclude,
} from "./rubberbanding-coverage-scope"

type SourceLocation = {
  readonly line: number
}

type SourceRange = {
  readonly start: SourceLocation
  readonly end: SourceLocation
}

export type IstanbulCoverageFile = {
  readonly path: string
  readonly statementMap: Record<string, SourceRange>
  readonly s: Record<string, number>
  readonly branchMap: Record<string, { readonly locations: readonly SourceRange[] }>
  readonly b: Record<string, readonly number[]>
  readonly fnMap: Record<string, { readonly loc: SourceRange }>
  readonly f: Record<string, number>
}

export type ChangedLineCoverageResult = {
  readonly ok: boolean
  readonly failures: readonly string[]
}

/**
 * Parses a unified git diff and returns added/modified line numbers by file.
 *
 * @param diff - Unified diff text.
 * @returns Repository-relative changed line sets.
 */
export function parseChangedLineDiff(diff: string): Map<string, Set<number>> {
  const changedLines = new Map<string, Set<number>>()
  let currentFile: string | null = null
  let nextLine: number | null = null

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length)
      if (!changedLines.has(currentFile)) changedLines.set(currentFile, new Set())
      nextLine = null
      continue
    }
    if (line.startsWith("@@")) {
      nextLine = parseHunkStart(line)
      continue
    }
    if (currentFile === null || nextLine === null) continue
    if (line.startsWith("+") && !line.startsWith("+++")) {
      changedLines.get(currentFile)?.add(nextLine)
      nextLine++
      continue
    }
    if (line.startsWith("-") && !line.startsWith("---")) continue
    nextLine++
  }

  return changedLines
}

/**
 * Asserts 100% coverage for changed executable lines in required files.
 *
 * @param options - Coverage map, changed line map, and required repository paths.
 * @returns Pass/fail result with coverage failures.
 */
export function assertChangedLineCoverage(options: {
  readonly coverageByFile: ReadonlyMap<string, IstanbulCoverageFile>
  readonly changedLinesByFile: ReadonlyMap<string, ReadonlySet<number>>
  readonly requiredFiles: readonly string[]
}): ChangedLineCoverageResult {
  const failures: string[] = []

  for (const file of options.requiredFiles) {
    const changedLines = options.changedLinesByFile.get(file)
    if (changedLines === undefined || changedLines.size === 0) continue
    const coverage = options.coverageByFile.get(file)
    if (coverage === undefined) continue

    for (const line of [...changedLines].sort((a, b) => a - b)) {
      failures.push(...coverageFailuresForLine(file, line, coverage))
    }
  }

  return { ok: failures.length === 0, failures }
}

/**
 * Runs the coverage assertion CLI.
 *
 * @param argv - CLI arguments after script name.
 * @param deps - File-system, shell, and logging dependencies.
 * @returns Process-style exit code.
 */
export function runAssertRubberbandingCoverage(
  argv: readonly string[],
  deps: {
    readonly cwd: string
    readonly readFile: (file: string, encoding: BufferEncoding) => string
    readonly exec: (command: string) => string
    readonly log: (value: string) => void
    readonly error: (value: string) => void
  },
): number {
  try {
    const coveragePath = readFlag(argv, "--coverage") ?? "coverage/coverage-final.json"
    const changedFiles = readChangedFiles(deps.exec)
    const requiredFiles = resolveRubberbandingCoverageInclude({ changedFiles })
    const changedLines = readChangedLines(deps.exec)
    const coverage = coverageMapFromJson(
      JSON.parse(deps.readFile(path.resolve(deps.cwd, coveragePath), "utf8")) as Record<
        string,
        IstanbulCoverageFile
      >,
      deps.cwd,
    )
    const result = assertChangedLineCoverage({
      coverageByFile: coverage,
      changedLinesByFile: changedLines,
      requiredFiles,
    })
    if (result.ok) {
      deps.log("rubberbanding changed-line coverage assertions passed")
      return 0
    }
    for (const failure of result.failures) deps.error(failure)
    return 1
  } catch (error) {
    deps.error("rubberbanding changed-line coverage assertion failed")
    if (error instanceof Error) deps.error(error.message)
    return 1
  }
}

/**
 * Detects direct CLI execution in Bun/tsx without running during test imports.
 *
 * @param argv - Process arguments.
 * @param metaUrl - Current module URL.
 * @returns True when this module is the invoked script.
 */
export function isCoverageCliEntrypoint(argv: readonly string[], metaUrl: string): boolean {
  const scriptPath = argv[1]
  return Boolean(scriptPath && pathToFileURL(scriptPath).href === metaUrl)
}

/**
 * Reads one `--flag value` pair from CLI args.
 *
 * @param argv - CLI arguments.
 * @param flag - Flag name.
 * @returns Flag value, or null when absent.
 */
function readFlag(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag)
  if (index === -1) return null
  return argv[index + 1] ?? null
}

/**
 * Parses the starting line of the added side of a unified diff hunk.
 *
 * @param hunkHeader - A unified diff hunk header.
 * @returns First line number on the added side, or null for malformed hunks.
 */
function parseHunkStart(hunkHeader: string): number | null {
  const match = /\+(\d+)(?:,\d+)?/.exec(hunkHeader)
  return match ? Number(match[1]) : null
}

/**
 * Reads unique changed files from committed, staged, and unstaged diffs.
 *
 * @param exec - Shell execution dependency.
 * @returns Changed repository paths.
 */
function readChangedFiles(exec: (command: string) => string): readonly string[] {
  return mergeRubberbandingChangedFiles([
    lines(exec("git diff --name-only origin/main...HEAD")),
    lines(exec("git diff --name-only --cached")),
    lines(exec("git diff --name-only")),
  ])
}

/**
 * Reads changed added-line sets from committed, staged, and unstaged diffs.
 *
 * @param exec - Shell execution dependency.
 * @returns Changed line sets by repository path.
 */
function readChangedLines(exec: (command: string) => string): ReadonlyMap<string, ReadonlySet<number>> {
  const merged = new Map<string, Set<number>>()
  for (const diff of [
    exec("git diff --unified=0 origin/main...HEAD"),
    exec("git diff --unified=0 --cached"),
    exec("git diff --unified=0"),
  ]) {
    for (const [file, lineSet] of parseChangedLineDiff(diff)) {
      let target = merged.get(file)
      if (!target) {
        target = new Set()
        merged.set(file, target)
      }
      for (const line of lineSet) target.add(line)
    }
  }
  return merged
}

/**
 * Converts Istanbul coverage JSON keys into repository-relative file paths.
 *
 * @param coverageJson - Parsed `coverage-final.json`.
 * @param cwd - Repository root.
 * @returns Coverage file map keyed by repository-relative paths.
 */
function coverageMapFromJson(
  coverageJson: Record<string, IstanbulCoverageFile>,
  cwd: string,
): ReadonlyMap<string, IstanbulCoverageFile> {
  return new Map(
    Object.entries(coverageJson).map(([absolutePath, coverage]) => [
      path.relative(cwd, absolutePath),
      coverage,
    ]),
  )
}

/**
 * Splits command output into trimmed non-empty lines.
 *
 * @param value - Command output.
 * @returns Output lines.
 */
function lines(value: string): readonly string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Finds coverage failures for one changed line.
 *
 * @param file - Repository-relative path.
 * @param line - Changed line number.
 * @param coverage - Istanbul coverage for the file.
 * @returns Failure messages for uncovered executable entries.
 */
function coverageFailuresForLine(
  file: string,
  line: number,
  coverage: IstanbulCoverageFile,
): readonly string[] {
  const failures: string[] = []
  const statementEntries = Object.entries(coverage.statementMap).filter(([, range]) =>
    rangeContainsLine(range, line),
  )
  if (
    statementEntries.length > 0 &&
    statementEntries.every(([id]) => (coverage.s[id] ?? 0) === 0)
  ) {
    failures.push(`${file}:${line} changed statement was not covered`)
  }

  const branchEntries = Object.entries(coverage.branchMap).filter(([, branch]) =>
    branch.locations.some((range) => rangeContainsLine(range, line)),
  )
  if (branchEntries.some(([id]) => (coverage.b[id] ?? []).some((count) => count === 0))) {
    failures.push(`${file}:${line} changed branch was not fully covered`)
  }

  const functionEntries = Object.entries(coverage.fnMap).filter(([, fn]) =>
    rangeContainsLine(fn.loc, line),
  )
  if (functionEntries.some(([id]) => (coverage.f[id] ?? 0) === 0)) {
    failures.push(`${file}:${line} changed function was not covered`)
  }
  return failures
}

/**
 * Checks whether a source range includes a line.
 *
 * @param range - Source range.
 * @param line - Line number.
 * @returns True when line is within range.
 */
function rangeContainsLine(range: SourceRange, line: number): boolean {
  return range.start.line <= line && range.end.line >= line
}

/* v8 ignore next 11 */
if (isCoverageCliEntrypoint(process.argv, import.meta.url)) {
  const code = runAssertRubberbandingCoverage(process.argv.slice(2), {
    cwd: process.cwd(),
    readFile: readFileSync,
    exec: (command) => execSync(command, { encoding: "utf8" }),
    log: console.log,
    error: console.error,
  })
  process.exit(code)
}
