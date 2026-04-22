import { WsEvent } from "./events"

/**
 * Colyseus room message type keys (snake_case).
 * Server rooms use these as `messages` object keys and `this.broadcast(key, payload)` args.
 * Clients use these with `room.send(key, payload)` and `room.onMessage(key, cb)`.
 */
export const RoomEvent = {
  // Chat (global)
  ChatMessage: "chat_message",
  ChatPresence: "chat_presence",

  // Lobby
  LobbyState: "lobby_state",
  LobbyChat: "lobby_chat",
  LobbyChatHistory: "lobby_chat_history",
  LobbyStartGame: "lobby_start_game",
  LobbyEndGame: "lobby_end_game",
  LobbyCountdown: "lobby_countdown",
  LobbyHostTransfer: "lobby_host_transfer",
  LobbyHeroSelect: "lobby_hero_select",
  LobbyScoreboard: "lobby_scoreboard",
  LobbyScoreboardCountdown: "lobby_scoreboard_countdown",
  LobbyReturnToLobby: "lobby_return_to_lobby",
  LobbyKicked: "lobby_kicked",
  LobbyError: "lobby_error",
  LobbyEndLobby: "lobby_end_lobby",

  // Game loading gate
  ClientSceneReady: "client_scene_ready",
  MatchCountdownStart: "match_countdown_start",
  MatchGo: "match_go",

  // Players
  PlayerJoin: "player_join",
  PlayerLeave: "player_leave",
  PlayerBatchUpdate: "player_batch_update",
  GameStateSync: "game_state_sync",
  PlayerDeath: "player_death",
  PlayerRespawn: "player_respawn",

  // Abilities
  FireballLaunch: "fireball_launch",
  FireballImpact: "fireball_impact",
  FireballBatchUpdate: "fireball_batch_update",
  LightningBolt: "lightning_bolt",
  AxeSwing: "axe_swing",

  // Shop / economy
  ShopPurchase: "shop_purchase",
  ShopState: "shop_state",
  ShopError: "shop_error",
  GoldBalance: "gold_balance",
  EquipItem: "equip_item",
  AssignAbility: "assign_ability",
  UseQuickItem: "use_quick_item",

  // Input
  PlayerInput: "player_input",

  // Damage display
  DamageFloat: "damage_float",

  // Resync
  RequestResync: "request_resync",
} as const

export type RoomEvent = (typeof RoomEvent)[keyof typeof RoomEvent]

/** Maps RoomEvent snake_case values → WsEvent SCREAMING_SNAKE values. */
export const roomToWsEvent: Record<string, string> = {}
/** Maps WsEvent SCREAMING_SNAKE values → RoomEvent snake_case values. */
export const wsToRoomEvent: Record<string, string> = {}

for (const key of Object.keys(WsEvent) as (keyof typeof WsEvent)[]) {
  if (key in RoomEvent) {
    roomToWsEvent[RoomEvent[key as keyof typeof RoomEvent]] = WsEvent[key]
    wsToRoomEvent[WsEvent[key]] = RoomEvent[key as keyof typeof RoomEvent]
  }
}
