import { z } from "zod"

import { protectedProcedure, router } from "../init"

/**
 * User router: get current user profile and update persistent settings (keybinds, volumes, combat numbers mode).
 */
export const userRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.sub },
      select: {
        id: true,
        username: true,
        combatNumbersMode: true,
        bgmVolume: true,
        sfxVolume: true,
        openSettingsKey: true,
      },
    })
    return { user }
  }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        combatNumbersMode: z.enum(["OFF", "ON", "ON_EXTENDED", "ON_FULL"]).optional(),
        bgmVolume: z.number().int().min(0).max(100).optional(),
        sfxVolume: z.number().int().min(0).max(100).optional(),
        openSettingsKey: z.string().min(1).max(32).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.user.update({
        where: { id: ctx.user.sub },
        data: {
          ...(input.combatNumbersMode !== undefined && { combatNumbersMode: input.combatNumbersMode }),
          ...(input.bgmVolume !== undefined && { bgmVolume: input.bgmVolume }),
          ...(input.sfxVolume !== undefined && { sfxVolume: input.sfxVolume }),
          ...(input.openSettingsKey !== undefined && { openSettingsKey: input.openSettingsKey }),
        },
        select: {
          id: true,
          combatNumbersMode: true,
          bgmVolume: true,
          sfxVolume: true,
          openSettingsKey: true,
        },
      })
      return { user: updated }
    }),
})
