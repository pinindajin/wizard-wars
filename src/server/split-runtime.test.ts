import { describe, expect, it } from "vitest"

import {
  buildSplitRuntimeChildSpecs,
  resolveSplitRuntimeConfig,
} from "./split-runtime"

describe("split runtime", () => {
  it("uses default ports when split runtime env is unset", () => {
    const config = resolveSplitRuntimeConfig({}, () => "generated-token")

    expect(config.webPort).toBe("3000")
    expect(config.realtimePort).toBe("3001")
    expect(config.realtimeUrl).toBe("http://127.0.0.1:3001")
    expect(config.adminToken).toBe("generated-token")
  })

  it("uses a generated admin token when the deploy environment omits one", () => {
    const config = resolveSplitRuntimeConfig(
      {
        PORT: "3000",
        WW_REALTIME_PORT: "3001",
      },
      () => "generated-token",
    )

    expect(config.webPort).toBe("3000")
    expect(config.realtimePort).toBe("3001")
    expect(config.realtimeUrl).toBe("http://127.0.0.1:3001")
    expect(config.adminToken).toBe("generated-token")
  })

  it("builds sibling web and realtime process specs with shared internal wiring", () => {
    const config = resolveSplitRuntimeConfig(
      {
        PORT: "3100",
        WW_REALTIME_PORT: "3101",
        WW_REALTIME_ADMIN_TOKEN: "shared-secret",
      },
      () => "unused",
    )

    const specs = buildSplitRuntimeChildSpecs(config, {
      bunExecutable: "bun",
      cwd: "/app",
    })

    expect(specs).toHaveLength(2)
    expect(specs[0]).toMatchObject({
      name: "realtime",
      command: "bun",
      args: ["src/server/colyseus/realtime-server.ts"],
      cwd: "/app",
    })
    expect(specs[0]?.env).toMatchObject({
      WW_SERVER_MODE: "realtime",
      RUN_MIGRATIONS: "false",
      PORT: "3101",
      WW_REALTIME_ADMIN_TOKEN: "shared-secret",
    })
    expect(specs[1]).toMatchObject({
      name: "web",
      command: "bun",
      args: ["server.ts"],
      cwd: "/app",
    })
    expect(specs[1]?.env).toMatchObject({
      WW_SERVER_MODE: "web",
      RUN_MIGRATIONS: "false",
      PORT: "3100",
      WW_REALTIME_ADMIN_URL: "http://127.0.0.1:3101",
      WW_REALTIME_PROXY_URL: "http://127.0.0.1:3101",
      WW_REALTIME_ADMIN_TOKEN: "shared-secret",
    })
  })

  it("falls back to cwd and the default Bun executable when launch options are omitted", () => {
    const config = resolveSplitRuntimeConfig(
      {
        PORT: "3100",
        WW_REALTIME_PORT: "3101",
        WW_REALTIME_ADMIN_TOKEN: "shared-secret",
      },
      () => "unused",
    )

    const specs = buildSplitRuntimeChildSpecs(config, {
      baseEnv: { NODE_ENV: "production" },
    })

    expect(specs[0]?.command).toBe("bun")
    expect(specs[0]?.cwd).toBe(process.cwd())
    expect(specs[1]?.command).toBe("bun")
    expect(specs[1]?.cwd).toBe(process.cwd())
  })

  it("keeps split child wiring local even when stale realtime URLs exist", () => {
    const config = resolveSplitRuntimeConfig(
      {
        PORT: "3100",
        WW_REALTIME_PORT: "3101",
        WW_REALTIME_ADMIN_TOKEN: "shared-secret",
      },
      () => "unused",
    )

    const specs = buildSplitRuntimeChildSpecs(config, {
      bunExecutable: "bun",
      cwd: "/app",
      baseEnv: {
        NODE_ENV: "production",
        WW_REALTIME_ADMIN_URL: "https://old-realtime.example.com",
        WW_REALTIME_PROXY_URL: "https://old-web.example.com",
      },
    })

    expect(specs[1]?.env).toMatchObject({
      WW_REALTIME_ADMIN_URL: "http://127.0.0.1:3101",
      WW_REALTIME_PROXY_URL: "http://127.0.0.1:3101",
    })
  })
})
