/**
 * Returns whether an unknown client error represents tRPC UNAUTHORIZED.
 *
 * @param err - Unknown caught error.
 * @returns True when the error has a tRPC unauthorized code shape.
 */
export function isUnauthorizedTrpcError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const shape = err as {
    readonly data?: { readonly code?: unknown }
    readonly shape?: { readonly data?: { readonly code?: unknown } }
  }
  return shape.data?.code === "UNAUTHORIZED" || shape.shape?.data?.code === "UNAUTHORIZED"
}
