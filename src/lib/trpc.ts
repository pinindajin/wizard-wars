import { QueryClient } from "@tanstack/react-query"
import { createTRPCClient, httpBatchLink } from "@trpc/client"
import superjson from "superjson"

import type { AppRouter } from "@/server/trpc/router"
import { getApiUrl } from "@/lib/endpoints"

/**
 * Creates a fresh React Query client.
 *
 * @returns New QueryClient instance.
 */
export const createQueryClient = () => {
  return new QueryClient()
}

/**
 * Creates a tRPC HTTP batch client with SuperJSON transformer and cookie credentials.
 *
 * @returns tRPC client for AppRouter.
 */
export const createTrpcClient = () => {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: getApiUrl(),
        transformer: superjson,
        fetch(url, options) {
          return fetch(url, { ...options, credentials: "include" })
        },
      }),
    ],
  })
}
