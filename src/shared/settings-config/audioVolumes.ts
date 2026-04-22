import { z } from "zod"

import { DEFAULT_BGM_VOLUME, DEFAULT_SFX_VOLUME } from "../balance-config/audio"

/** Zod schema for audio volume settings (0-100 integer). */
export const audioVolumeSchema = z.object({
  bgmVolume: z.number().int().min(0).max(100).default(DEFAULT_BGM_VOLUME),
  sfxVolume: z.number().int().min(0).max(100).default(DEFAULT_SFX_VOLUME),
})

export type AudioVolumeSettings = z.infer<typeof audioVolumeSchema>
