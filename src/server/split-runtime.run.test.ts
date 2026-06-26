import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { loggerMock, spawnMock } = vi.hoisted(() => ({
  loggerMock: {
    error: vi.fn(),
    fatal: vi.fn(),
    info: vi.fn(),
  },
  spawnMock: vi.fn(),
}))

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}))

vi.mock("./logger", () => ({
  logger: loggerMock,
}))

import { runSplitRuntime, type SplitRuntimeChildSpec } from "./split-runtime"

type MockChildProcess = ChildProcess & {
  killed: boolean
  kill: ReturnType<typeof vi.fn>
  spawnargs: string[]
}

const specs: readonly SplitRuntimeChildSpec[] = [
  {
    name: "realtime",
    command: "bun",
    args: ["src/server/colyseus/realtime-server.ts"],
    cwd: "/app",
    env: { NODE_ENV: "production", WW_SERVER_MODE: "realtime" },
  },
  {
    name: "web",
    command: "bun",
    args: ["server.ts"],
    cwd: "/app",
    env: { NODE_ENV: "production", WW_SERVER_MODE: "web" },
  },
]

describe("split runtime supervisor", () => {
  const children: MockChildProcess[] = []
  const originalSigtermListeners = process.listeners("SIGTERM")
  const originalSigintListeners = process.listeners("SIGINT")

  beforeEach(() => {
    children.length = 0
    spawnMock.mockImplementation((command: string, args: string[]) => {
      const child = createMockChild(command, args)
      children.push(child)
      return child
    })
  })

  afterEach(() => {
    spawnMock.mockReset()
    loggerMock.error.mockReset()
    loggerMock.fatal.mockReset()
    loggerMock.info.mockReset()
    for (const listener of process.listeners("SIGTERM")) {
      if (!originalSigtermListeners.includes(listener)) {
        process.off("SIGTERM", listener)
      }
    }
    for (const listener of process.listeners("SIGINT")) {
      if (!originalSigintListeners.includes(listener)) {
        process.off("SIGINT", listener)
      }
    }
  })

  it("stops sibling children and resolves nonzero when one child exits", async () => {
    const result = runSplitRuntime(specs)

    expect(children).toHaveLength(2)
    children[0]?.emit("exit", 7, null)

    expect(children[0]?.kill).not.toHaveBeenCalled()
    expect(children[1]?.kill).toHaveBeenCalledWith("SIGTERM")
    children[1]?.emit("exit", null, "SIGTERM")

    await expect(result).resolves.toBe(7)
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "split_runtime.child.exited",
        code: 7,
        signal: null,
      }),
      "Split runtime child exited",
    )
  })

  it("stops sibling children and resolves one when a child spawn fails", async () => {
    const result = runSplitRuntime(specs)
    const spawnError = new Error("spawn failed")

    children[1]?.emit("error", spawnError)

    expect(children[0]?.kill).toHaveBeenCalledWith("SIGTERM")
    expect(children[1]?.kill).not.toHaveBeenCalled()
    children[0]?.emit("exit", null, "SIGTERM")

    await expect(result).resolves.toBe(1)
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "split_runtime.child.spawn_failed",
        err: spawnError,
      }),
      "Split runtime child failed to spawn",
    )
  })

  it("treats signal exits as failures and skips children already marked killed", async () => {
    const result = runSplitRuntime(specs)
    children[0]!.killed = true

    children[1]?.emit("exit", null, "SIGTERM")

    expect(children[0]?.kill).not.toHaveBeenCalled()
    expect(children[1]?.kill).not.toHaveBeenCalled()
    children[0]?.emit("exit", null, "SIGTERM")

    await expect(result).resolves.toBe(1)
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "split_runtime.child.exited",
        code: null,
        signal: "SIGTERM",
      }),
      "Split runtime child exited",
    )
  })

  it("ignores later child exits after shutdown has started", async () => {
    const result = runSplitRuntime(specs)

    children[0]?.emit("exit", 7, null)
    children[1]?.emit("exit", 8, null)

    await expect(result).resolves.toBe(7)
    expect(loggerMock.error).toHaveBeenCalledTimes(1)
  })

  it("ignores explicit shutdown attempts after shutdown has started", async () => {
    const result = runSplitRuntime(specs)

    children[0]?.emit("exit", 7, null)
    children[1]?.emit("error", new Error("late spawn error"))

    await expect(result).resolves.toBe(7)
    expect(children[0]?.kill).not.toHaveBeenCalled()
    expect(children[1]?.kill).toHaveBeenCalledTimes(1)
  })

  it("resolves zero when a child exits without code or signal", async () => {
    const result = runSplitRuntime(specs)

    children[0]?.emit("exit", null, null)
    children[1]?.emit("exit", null, "SIGTERM")

    await expect(result).resolves.toBe(0)
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "split_runtime.child.exited",
        code: null,
        signal: null,
      }),
      "Split runtime child exited",
    )
  })

  it("escalates shutdown when a sibling child does not exit before timeout", async () => {
    const result = runSplitRuntime(specs, { shutdownTimeoutMs: 1 })

    children[0]?.emit("exit", 7, null)

    await expect(result).resolves.toBe(7)
    expect(children[1]?.kill).toHaveBeenNthCalledWith(1, "SIGTERM")
    expect(children[1]?.kill).toHaveBeenNthCalledWith(2, "SIGKILL")
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "split_runtime.shutdown_timeout",
        timeoutMs: 1,
      }),
      "Split runtime child shutdown timed out",
    )
  })
})

function createMockChild(command: string, args: string[]): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.killed = false
  child.spawnargs = [command, ...args]
  child.kill = vi.fn(() => {
    child.killed = true
    return true
  })
  return child
}
