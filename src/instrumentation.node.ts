import path from "node:path"

import { config as loadDotenv } from "dotenv"

/**
 * Node-only instrumentation: loads .env on server startup.
 * Imported dynamically from instrumentation.ts only when NEXT_RUNTIME === "nodejs".
 */
export function registerNodeInstrumentation(): void {
  loadDotenv({ path: path.join(process.cwd(), ".env") })
}
