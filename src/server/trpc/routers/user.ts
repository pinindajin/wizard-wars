import { z } from "zod"
import { Prisma } from "@prisma/client"
import { TRPCError } from "@trpc/server"

import { createClearAuthCookie } from "@/server/auth"
import { MINIMAP_CORNERS } from "@/shared/settings-config"
import { protectedProcedure, router } from "../init"

/**
 * Returns whether an unknown error is Prisma's record-not-found update failure.
 *
 * @param err - Unknown caught error.
 * @returns True when the error represents a missing required record.
 */
function isPrismaRecordNotFoundError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025"
  ) || (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { readonly code?: unknown }).code === "P2025"
  )
}

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
        minimapCorner: true,
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
        minimapCorner: z.enum(MINIMAP_CORNERS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const updated = await ctx.prisma.user.update({
          where: { id: ctx.user.sub },
          data: {
            ...(input.combatNumbersMode !== undefined && { combatNumbersMode: input.combatNumbersMode }),
            ...(input.bgmVolume !== undefined && { bgmVolume: input.bgmVolume }),
            ...(input.sfxVolume !== undefined && { sfxVolume: input.sfxVolume }),
            ...(input.openSettingsKey !== undefined && { openSettingsKey: input.openSettingsKey }),
            ...(input.minimapCorner !== undefined && { minimapCorner: input.minimapCorner }),
          },
          select: {
            id: true,
            combatNumbersMode: true,
            bgmVolume: true,
            sfxVolume: true,
            openSettingsKey: true,
            minimapCorner: true,
          },
        })
        return { user: updated }
      } catch (err) {
        if (!isPrismaRecordNotFoundError(err)) throw err
        ctx.setCookie?.(createClearAuthCookie())
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Session expired. Please log in again.",
        })
      }
    }),
})
