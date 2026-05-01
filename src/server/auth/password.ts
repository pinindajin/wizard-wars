import bcrypt from "bcryptjs"

/**
 * Password hashing for signup/login (bcrypt). Node-only; not used by Edge middleware.
 */

/**
 * Hashes a plaintext password with bcrypt (cost factor 10).
 *
 * @param password - Raw password from signup/login forms.
 * @returns bcrypt hash string suitable for `User.passwordHash` in Prisma.
 */
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, 10)
}

/**
 * Compares a plaintext password to a stored bcrypt hash.
 *
 * @param password - Candidate password from login.
 * @param hash - Stored `passwordHash` from the database.
 * @returns `true` if the password matches.
 */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash)
}
