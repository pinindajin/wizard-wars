export const ServerLogLevel = {
  Fatal: "fatal",
  Error: "error",
  Warn: "warn",
  Info: "info",
  Debug: "debug",
  Trace: "trace",
  Silent: "silent",
} as const

export type ServerLogLevel = (typeof ServerLogLevel)[keyof typeof ServerLogLevel]

export const ClientLogLevel = {
  Error: "error",
  Warn: "warn",
  Info: "info",
  Debug: "debug",
  Trace: "trace",
  Silent: "silent",
} as const

export type ClientLogLevel = (typeof ClientLogLevel)[keyof typeof ClientLogLevel]

export const SERVER_LOG_LEVELS = Object.values(ServerLogLevel)
export const CLIENT_LOG_LEVELS = Object.values(ClientLogLevel)

export const DEFAULT_SERVER_LOG_LEVEL = ServerLogLevel.Warn
export const DEFAULT_CLIENT_LOG_LEVEL = ClientLogLevel.Silent

export function parseServerLogLevel(value: unknown): ServerLogLevel | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  return SERVER_LOG_LEVELS.includes(normalized as ServerLogLevel)
    ? (normalized as ServerLogLevel)
    : null
}

export function parseClientLogLevel(value: unknown): ClientLogLevel | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  return CLIENT_LOG_LEVELS.includes(normalized as ClientLogLevel)
    ? (normalized as ClientLogLevel)
    : null
}

export function isServerLogLevel(value: unknown): value is ServerLogLevel {
  return parseServerLogLevel(value) !== null
}

export function isClientLogLevel(value: unknown): value is ClientLogLevel {
  return parseClientLogLevel(value) !== null
}
