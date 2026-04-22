import pino from "pino"

/**
 * Application-wide structured logger (pino). Uses pretty-print in development and
 * compact JSON in production for Render's log aggregation UI.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
})
