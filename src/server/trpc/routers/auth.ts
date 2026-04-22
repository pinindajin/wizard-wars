import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { loginUsernameSchema, signupUsernameSchema } from "../../../shared/validators"
import { createAuthCookie, hashPassword, signToken, verifyPassword } from "../../auth"
import { publicProcedure, router } from "../init"
import { logger } from "../../logger"

const signupInput = z.object({
  username: signupUsernameSchema,
  password: z.string().min(8).max(128),
})

const loginInput = z.object({
  username: loginUsernameSchema,
  password: z.string().min(8).max(128),
})

/**
 * Auth router: signup and login mutations that set the ww-token HttpOnly cookie.
 * Username is stored as-is for display and lowercased in usernameLower for case-insensitive uniqueness.
 */
export const authRouter = router({
  signup: publicProcedure.input(signupInput).mutation(async ({ ctx, input }) => {
    const usernameLower = input.username.toLowerCase()

    const existingUser = await ctx.prisma.user.findFirst({
      where: { usernameLower },
      select: { username: true },
    })

    if (existingUser) {
      logger.info({ event: "auth.signup.username_taken", username: input.username }, "Username taken")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Username is already taken",
      })
    }

    const passwordHash = await hashPassword(input.password)
    const user = await ctx.prisma.user.create({
      data: {
        username: input.username,
        usernameLower,
        passwordHash,
      },
      select: { id: true, username: true },
    })

    logger.info({ event: "auth.signup.success", userId: user.id, username: user.username }, "New user signed up")
    const token = await signToken({ sub: user.id, username: user.username })
    ctx.setCookie?.(createAuthCookie(token))

    return { user }
  }),

  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
    const usernameLower = input.username.toLowerCase()

    const user = await ctx.prisma.user.findUnique({
      where: { usernameLower },
      select: { id: true, username: true, passwordHash: true },
    })

    if (!user) {
      logger.info({ event: "auth.login.failed", username: input.username, reason: "not_found" }, "Login failed: user not found")
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      })
    }

    const isValid = await verifyPassword(input.password, user.passwordHash)
    if (!isValid) {
      logger.info({ event: "auth.login.failed", username: input.username, reason: "bad_password" }, "Login failed: wrong password")
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      })
    }

    logger.info({ event: "auth.login.success", userId: user.id, username: user.username }, "User logged in")
    const token = await signToken({ sub: user.id, username: user.username })
    ctx.setCookie?.(createAuthCookie(token))

    return { user: { id: user.id, username: user.username } }
  }),
})
