const REDACTED = "[REDACTED]"
const MAX_STRING_LENGTH = 240
const MAX_ARRAY_ITEMS = 8
const MAX_OBJECT_KEYS = 24
const MAX_DEPTH = 4

const SENSITIVE_KEY_PATTERNS = [
  "authorization",
  "cookie",
  "password",
  "passwordhash",
  "secret",
  "token",
  "ww-token",
]

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9-]/g, "")
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern))
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value
  return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated:${value.length}]`
}

export function sanitizeForLog(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === "string") return truncateString(value)
  if (typeof value !== "object" || value === null) return value
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: value.stack ? truncateString(value.stack) : undefined,
    }
  }
  if (depth >= MAX_DEPTH) return "[MaxDepth]"
  if (seen.has(value)) return "[Circular]"
  seen.add(value)

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, seen, depth + 1))
  }

  const out: Record<string, unknown> = {}
  for (const [key, entryValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    out[key] = shouldRedactKey(key) ? REDACTED : sanitizeForLog(entryValue, seen, depth + 1)
  }
  return out
}

export function summarizePayload(value: unknown): unknown {
  return sanitizeForLog(value)
}
