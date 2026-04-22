import superjson, { type SuperJSONResult } from "superjson"

type TrpcMutationPayload = {
  error?: {
    json?: unknown
    message?: string
  }
}

/**
 * Checks whether an object is a SuperJSON-encoded result.
 *
 * @param obj - Value to check.
 * @returns `true` if the object has a `json` property (SuperJSON result shape).
 */
function isSuperJsonEncoded(obj: unknown): obj is SuperJSONResult {
  return typeof obj === "object" && obj !== null && "json" in obj
}

/**
 * Extracts a human-readable error message from a tRPC mutation error response.
 * Handles SuperJSON-encoded errors and Zod validation errors.
 *
 * @param payload - The raw response body from a tRPC mutation.
 * @returns The first meaningful error string, or `null` if none found.
 */
export function getTrpcMutationErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const root = payload as TrpcMutationPayload
  const err = root.error
  if (!err || typeof err !== "object") return null

  let jsonData: unknown = err.json

  if (isSuperJsonEncoded(jsonData)) {
    try {
      jsonData = superjson.deserialize(jsonData)
    } catch {
      jsonData = null
    }
  }

  if (typeof jsonData === "object" && jsonData !== null) {
    const typedData = jsonData as Record<string, unknown>
    const zodError = (typedData.data as Record<string, unknown> | undefined)?.zodError as
      | Record<string, unknown>
      | undefined
    if (zodError) {
      const fieldErrors = zodError.fieldErrors as Record<string, string[] | undefined> | undefined
      const formErrors = zodError.formErrors as string[] | undefined
      const fieldMsgs = Object.values(fieldErrors ?? {})
        .flat()
        .filter((msg): msg is string => typeof msg === "string")
      const allMsgs = [...fieldMsgs, ...(formErrors ?? [])]
      if (allMsgs[0]) return allMsgs[0]
    }
    if (typeof typedData.message === "string") return typedData.message
  }

  if (typeof err.message === "string") return err.message
  return null
}
