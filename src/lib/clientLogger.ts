import {
  ClientLogLevel,
  DEFAULT_CLIENT_LOG_LEVEL,
  parseClientLogLevel,
  type ClientLogLevel as ClientLogLevelType,
} from "@/shared/logging/levels"
import { sanitizeForLog } from "@/shared/logging/sanitize"

const STORAGE_KEY = "ww_log_level"
const SESSION_KEY = "ww_client_session_id"

const LEVEL_WEIGHT: Record<ClientLogLevelType, number> = {
  [ClientLogLevel.Trace]: 10,
  [ClientLogLevel.Debug]: 20,
  [ClientLogLevel.Info]: 30,
  [ClientLogLevel.Warn]: 40,
  [ClientLogLevel.Error]: 50,
  [ClientLogLevel.Silent]: 100,
}

export type ClientLogFields = {
  readonly event: string
  readonly area?: string
  readonly side?: "client"
  readonly roomId?: string
  readonly playerId?: string
  readonly sessionId?: string
  readonly clientSessionId?: string
  readonly seq?: number
  readonly phase?: string | null
  readonly reason?: string
  readonly [key: string]: unknown
}

type ClientLogEntry = ClientLogFields & {
  readonly ts: string
  readonly level: Exclude<ClientLogLevelType, "silent">
  readonly side: "client"
}

type ClientLogSink = {
  readonly name: string
  write(entry: ClientLogEntry, message?: string): void
}

class ConsoleLogSink implements ClientLogSink {
  readonly name = "console"

  write(entry: ClientLogEntry, message?: string): void {
    const method = entry.level === ClientLogLevel.Trace ? "debug" : entry.level
    console[method](sanitizeForLog(entry), message)
  }
}

function getStoredLevel(): ClientLogLevelType {
  if (typeof window === "undefined") return DEFAULT_CLIENT_LOG_LEVEL
  return parseClientLogLevel(window.localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_CLIENT_LOG_LEVEL
}

function persistLevel(level: ClientLogLevelType): void {
  if (typeof window === "undefined") return
  if (level === ClientLogLevel.Silent) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }
  window.localStorage.setItem(STORAGE_KEY, level)
}

export function getClientSessionId(): string {
  if (typeof window === "undefined") return "server"
  const existing = window.sessionStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  window.sessionStorage.setItem(SESSION_KEY, next)
  return next
}

export class ClientLogger {
  private levelValue: ClientLogLevelType = getStoredLevel()

  constructor(
    private readonly context: Omit<ClientLogFields, "event"> = {},
    private readonly sinks: readonly ClientLogSink[] = [new ConsoleLogSink()],
  ) {}

  child(context: Omit<ClientLogFields, "event">): ClientLogger {
    return new ClientLogger({ ...this.context, ...context }, this.sinks)
  }

  level(level?: ClientLogLevelType): ClientLogLevelType {
    if (level) {
      this.levelValue = level
      persistLevel(level)
    }
    return this.levelValue
  }

  enable(level: ClientLogLevelType = ClientLogLevel.Debug): void {
    this.level(level)
  }

  disable(): void {
    this.level(ClientLogLevel.Silent)
  }

  isEnabled(level: Exclude<ClientLogLevelType, "silent">): boolean {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.levelValue]
  }

  status(): { enabled: boolean; level: ClientLogLevelType; sinks: string[] } {
    return {
      enabled: this.levelValue !== ClientLogLevel.Silent,
      level: this.levelValue,
      sinks: this.sinks.map((sink) => sink.name),
    }
  }

  trace(fields: ClientLogFields, message?: string): void {
    this.write(ClientLogLevel.Trace, fields, message)
  }

  debug(fields: ClientLogFields, message?: string): void {
    this.write(ClientLogLevel.Debug, fields, message)
  }

  info(fields: ClientLogFields, message?: string): void {
    this.write(ClientLogLevel.Info, fields, message)
  }

  warn(fields: ClientLogFields, message?: string): void {
    this.write(ClientLogLevel.Warn, fields, message)
  }

  error(fields: ClientLogFields, message?: string): void {
    this.write(ClientLogLevel.Error, fields, message)
  }

  private write(level: Exclude<ClientLogLevelType, "silent">, fields: ClientLogFields, message?: string): void {
    if (!this.isEnabled(level)) return
    const entry: ClientLogEntry = {
      ...this.context,
      ...fields,
      side: "client",
      clientSessionId: String(fields.clientSessionId ?? this.context.clientSessionId ?? getClientSessionId()),
      ts: new Date().toISOString(),
      level,
    }
    for (const sink of this.sinks) {
      sink.write(entry, message)
    }
  }
}

export const clientLogger = new ClientLogger()

type WwLogControls = {
  enable(level?: ClientLogLevelType): void
  disable(): void
  level(level?: ClientLogLevelType): ClientLogLevelType
  status(): { enabled: boolean; level: ClientLogLevelType; sinks: string[] }
}

declare global {
  interface Window {
    wwLog?: WwLogControls
  }
}

export function installWwLogControls(): void {
  if (typeof window === "undefined") return
  window.wwLog = {
    enable(level = ClientLogLevel.Debug) {
      const parsed = parseClientLogLevel(level)
      if (!parsed) throw new Error(`Invalid wwLog level: ${level}`)
      clientLogger.enable(parsed)
    },
    disable() {
      clientLogger.disable()
    },
    level(level?: ClientLogLevelType) {
      if (level === undefined) return clientLogger.level()
      const parsed = parseClientLogLevel(level)
      if (!parsed) throw new Error(`Invalid wwLog level: ${level}`)
      return clientLogger.level(parsed)
    },
    status() {
      return clientLogger.status()
    },
  }
}
