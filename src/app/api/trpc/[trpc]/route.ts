import { fetchRequestHandler } from "@trpc/server/adapters/fetch"

import { appRouter } from "@/server/trpc/router"
import { createTrpcContext } from "@/server/trpc/init"

/**
 * tRPC HTTP handler for all /api/trpc/* routes.
 * Handles cookie injection from mutations (signup, login).
 */
const handler = async (request: Request): Promise<Response> => {
  let cookieToSet: string | null = null

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: async () =>
      createTrpcContext({
        headers: request.headers,
        setCookie: (cookieValue) => {
          cookieToSet = cookieValue
        },
      }),
  })

  if (cookieToSet) {
    response.headers.append("set-cookie", cookieToSet)
  }

  return response
}

export { handler as GET, handler as POST }
