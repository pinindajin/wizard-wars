"use client"

import { useEffect } from "react"

import { installWwLogControls } from "@/lib/clientLogger"

export function ClientLoggerInstaller() {
  useEffect(() => {
    installWwLogControls()
  }, [])

  return null
}
