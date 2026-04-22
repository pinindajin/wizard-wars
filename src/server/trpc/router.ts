import { router, publicProcedure } from "./init"
import { authRouter } from "./routers/auth"
import { userRouter } from "./routers/user"
import { chatRouter } from "./routers/chat"

/**
 * Root tRPC application router: aggregates domain routers (auth, user, chat) plus a health query.
 * Export type AppRouter drives the client AppRouter type import path.
 */
export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" })),
  auth: authRouter,
  user: userRouter,
  chat: chatRouter,
})

export type AppRouter = typeof appRouter
