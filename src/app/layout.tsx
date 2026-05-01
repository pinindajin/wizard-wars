import type { Metadata } from "next"
import { Geist, Geist_Mono, Cinzel } from "next/font/google"
import Script from "next/script"
import "./globals.css"
import { ClientLoggerInstaller } from "./ClientLoggerInstaller"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
})

export const metadata: Metadata = {
  title: "Wizard Wars",
  description: "Multiplayer top-down arena shooter",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} antialiased`}>
        <Script
          id="chunk-load-recovery"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                const shouldReloadForChunkError = (text) =>
                  typeof text === "string" &&
                  (text.includes("ChunkLoadError") || text.includes("Failed to load chunk"));

                const reloadForChunkError = () => {
                  const key = "ww_chunk_reload_attempted";
                  if (window.sessionStorage.getItem(key) === "1") return;
                  window.sessionStorage.setItem(key, "1");
                  window.location.reload();
                };

                window.addEventListener("error", (event) => {
                  if (shouldReloadForChunkError(event.message || "")) reloadForChunkError();
                });

                window.addEventListener("unhandledrejection", (event) => {
                  const reason = typeof event.reason === "string"
                    ? event.reason
                    : (event.reason && event.reason.message) ? event.reason.message : "unknown";
                  if (shouldReloadForChunkError(reason || "")) reloadForChunkError();
                });
              })();
            `,
          }}
        />
        <ClientLoggerInstaller />
        {children}
      </body>
    </html>
  )
}
