import { protectedProcedure, router } from "../init"

/**
 * Chat router: fetches the latest saved chat log for hydrating /home on page load.
 */
export const chatRouter = router({
  latest: protectedProcedure.query(async ({ ctx }) => {
    const messages = await ctx.chatStore.getLatestChatLog()
    return { messages: messages ?? [] }
  }),
})
