/**
 * Runs once per Node server process before other modules handle requests.
 * Ensures .env is loaded for App Router + Turbopack workers (Prisma DATABASE_URL).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return
  }
  const { registerNodeInstrumentation } = await import("./instrumentation.node")
  registerNodeInstrumentation()
}
