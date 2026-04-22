/**
 * Wizard Wars shared types: auth, chat, player state, lobby, game events.
 * Used by both server and client code.
 */

/** Authenticated user extracted from the JWT payload. */
export type AuthUser = {
  readonly sub: string
  readonly username: string
}

/** A single chat message stored in the buffer and sent to joining clients. */
export type ChatMessage = {
  readonly id: string
  readonly userId: string
  readonly username: string
  readonly text: string
  readonly createdAt: string
}

/** A user visible in the global chat presence list. */
export type ChatPresenceUser = {
  readonly userId: string
  readonly username: string
}

/** Outbound payload for global chat presence (full list). */
export type ChatPresencePayload = {
  readonly users: readonly ChatPresenceUser[]
}

/** Inbound chat message payload from the client. */
export type ChatMessagePayload = {
  readonly text: string
}

// --- Game lobby types ---

/** Lobby FSM phases. */
export type LobbyPhase = "LOBBY" | "WAITING_FOR_CLIENTS" | "COUNTDOWN" | "IN_PROGRESS" | "SCOREBOARD"

/** A player's entry in the lobby roster. */
export type LobbyPlayer = {
  readonly playerId: string
  readonly userId: string
  readonly username: string
  readonly heroId: string
  readonly isReady: boolean
  readonly isHost: boolean
}

/** Full lobby state snapshot sent on join and phase transitions. */
export type LobbyStatePayload = {
  readonly lobbyId: string
  readonly phase: LobbyPhase
  readonly players: readonly LobbyPlayer[]
  readonly hostPlayerId: string | null
  readonly maxPlayers: number
  readonly startedAtServerTimeMs?: number
}

/** A single lobby chat message (separate from global /home chat). */
export type LobbyChatPayload = {
  readonly id: string
  readonly userId: string
  readonly username: string
  readonly text: string
  readonly createdAt: string
}

/** Server → joiner: replay buffered lobby chat on join. */
export type LobbyChatHistoryPayload = {
  readonly messages: readonly LobbyChatPayload[]
}

/** Client (host) → server: close the lobby or cancel countdown. */
export type LobbyEndLobbyPayload = Record<string, never>

/** Client (host) → server: start the match. */
export type LobbyStartGamePayload = Record<string, never>

/** Client (host) → server: end the in-progress match and show scoreboard. */
export type LobbyEndGamePayload = Record<string, never>

/** Server → all: countdown tick before IN_PROGRESS. */
export type LobbyCountdownPayload = {
  readonly remaining: number
}

/** Server → all: new host after prior host disconnected. */
export type LobbyHostTransferPayload = {
  readonly hostPlayerId: string
  readonly hostUsername: string
}

/** Server → all: hero select for a player. */
export type LobbyHeroSelectPayload = {
  readonly playerId: string
  readonly heroId: string
}

/** Client → server: select a hero. */
export type HeroSelectPayload = {
  readonly heroId: string
}

// --- Game state types ---

/** A snapshot of a single player's position and state (sent in batch updates). */
export type PlayerSnapshot = {
  readonly id: number // bitECS entity id
  readonly playerId: string // userId (sub)
  readonly username: string
  readonly x: number
  readonly y: number
  readonly facingAngle: number
  readonly health: number
  readonly maxHealth: number
  readonly lives: number
  readonly heroId: string
  readonly animState: PlayerAnimState
  readonly invulnerable: boolean
}

/** A partial update for a player (only changed fields). */
export type PlayerDelta = {
  readonly id: number
  readonly x?: number
  readonly y?: number
  readonly facingAngle?: number
  readonly health?: number
  readonly lives?: number
  readonly animState?: PlayerAnimState
  readonly invulnerable?: boolean
}

/** Animation state reported by the server for client rendering. */
export type PlayerAnimState =
  | "idle"
  | "walk"
  | "dying"
  | "light_cast"
  | "heavy_cast"
  | "axe_swing"
  | "dead"

/** Batch player state update payload. */
export type PlayerBatchUpdatePayload = {
  readonly deltas: readonly PlayerDelta[]
  readonly removedIds: readonly number[]
  readonly seq: number
}

/** Full game state sync for late-joiners or reconnects. */
export type GameStateSyncPayload = {
  readonly players: readonly PlayerSnapshot[]
  readonly seq: number
}

/** A fireball projectile snapshot. */
export type FireballSnapshot = {
  readonly id: number
  readonly ownerId: string
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
}

/** Fireball batch update. */
export type FireballBatchUpdatePayload = {
  readonly deltas: readonly { id: number; x: number; y: number }[]
  readonly removedIds: readonly number[]
  readonly seq: number
}

/** Server → all: fireball launched. */
export type FireballLaunchPayload = {
  readonly id: number
  readonly ownerId: string
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
}

/** Server → all: fireball hit something. */
export type FireballImpactPayload = {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly targetId?: string
  readonly damage?: number
  readonly knockbackX?: number
  readonly knockbackY?: number
}

/** Lightning bolt cast event (geometry + damage results). */
export type LightningBoltPayload = {
  readonly casterId: string
  readonly originX: number
  readonly originY: number
  readonly targetX: number
  readonly targetY: number
  /** Random seed used to deterministically compute the branch arcs on client and server. */
  readonly seed: number
  readonly hitPlayerIds: readonly string[]
  readonly damage: number
}

/** Axe swing event payload. */
export type AxeSwingPayload = {
  readonly casterId: string
  readonly x: number
  readonly y: number
  readonly facingAngle: number
  readonly hitPlayerIds: readonly string[]
  readonly damage: number
}

/** Player death event. */
export type PlayerDeathPayload = {
  readonly playerId: string
  readonly killerPlayerId: string | null
  readonly killerAbilityId: string | null
  readonly livesRemaining: number
  readonly x: number
  readonly y: number
}

/** Player respawn event. */
export type PlayerRespawnPayload = {
  readonly playerId: string
  readonly spawnX: number
  readonly spawnY: number
  readonly facingAngle: number
}

/** Gold balance update for a single player. */
export type GoldBalancePayload = {
  readonly gold: number
}

/** Shop state update for a single player. */
export type ShopStatePayload = {
  readonly gold: number
  readonly items: readonly ShopOwnedItem[]
  readonly equippedWeaponItemId: string | null
  readonly augmentItemIds: readonly string[]
  readonly abilitySlots: readonly (string | null)[]
  readonly quickItemSlots: readonly QuickItemSlot[]
}

/** An item the player owns. */
export type ShopOwnedItem = {
  readonly itemId: string
  readonly charges?: number
}

/** One quick-item slot. */
export type QuickItemSlot = {
  readonly itemId: string | null
  readonly charges: number
}

/** Client → server: buy an item. */
export type ShopPurchasePayload = {
  readonly itemId: string
}

/** Server → player: purchase rejected. */
export type ShopErrorPayload = {
  readonly reason: string
}

/** Client → server: use a quick item slot. */
export type UseQuickItemPayload = {
  readonly slotIndex: number
}

/** Client → server: equip an item (weapon or augment). */
export type EquipItemPayload = {
  readonly itemId: string
}

/** Client → server: assign ability to ability bar slot. */
export type AssignAbilityPayload = {
  readonly abilityId: string
  readonly slotIndex: number
}

/** Client → server: player input per tick. */
export type PlayerInputPayload = {
  readonly up: boolean
  readonly down: boolean
  readonly left: boolean
  readonly right: boolean
  readonly abilitySlot: number | null // 0-4 (null = no cast this tick)
  readonly abilityTargetX: number
  readonly abilityTargetY: number
  readonly weaponPrimary: boolean
  readonly weaponSecondary: boolean
  readonly weaponTargetX: number
  readonly weaponTargetY: number
  readonly useQuickItemSlot: number | null // 0-3
  readonly seq: number
}

/** Server → all: damage number floats. */
export type DamageFloatPayload = {
  readonly targetId: string
  readonly amount: number
  readonly x: number
  readonly y: number
  readonly isCrit?: boolean
}

/** Scoreboard entry for a single player. */
export type ScoreboardEntry = {
  readonly playerId: string
  readonly username: string
  readonly heroId: string
  readonly kills: number
  readonly deaths: number
  readonly livesRemaining: number
  readonly goldEarned: number
}

/** Server → all: end-of-match scoreboard. */
export type LobbyScoreboardPayload = {
  readonly entries: readonly ScoreboardEntry[]
  readonly endReason: "lives_depleted" | "host_ended" | "time_cap"
}

/** Server → all: auto-return countdown from scoreboard. */
export type LobbyScoreboardCountdownPayload = {
  readonly remaining: number
}

/** Client → server: leave scoreboard and return to lobby. */
export type LobbyReturnToLobbyPayload = Record<string, never>

/** Server → client: kicked from lobby. */
export type LobbyKickedPayload = {
  readonly reason: string
}

/** Server → client: generic lobby error. */
export type LobbyErrorPayload = {
  readonly message: string
}

/** Client → server: signal that the arena scene has finished loading. */
export type ClientSceneReadyPayload = Record<string, never>

/** Server → all: begin the synced 3-2-1-GO countdown. */
export type MatchCountdownStartPayload = {
  readonly startAtServerTimeMs: number
  readonly durationMs: number
}

/** Server → all: countdown over, start playing. */
export type MatchGoPayload = Record<string, never>

/** Unified message shape for transport normalization. */
export type AnyWsMessage = {
  readonly type: string
  readonly payload: unknown
}

/** Function signature for transport message subscribers. */
export type MessageHandler = (message: AnyWsMessage) => void
