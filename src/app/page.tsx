import { redirect } from "next/navigation"

/**
 * Root page: redirect to /home (middleware will redirect to /login if unauthenticated).
 */
export default function RootPage() {
  redirect("/home")
}
