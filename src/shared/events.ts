/**
 * Wizard Wars WebSocket event type enum.
 * Client uses these as message type identifiers. Server sends these in `room.broadcast` / `room.send`.
 */
export const WsEvent = {
  // Chat (global)
  ChatMessage: "CHAT_MESSAGE",
  ChatPresence: "CHAT_PRESENCE",

  // Lobby
  LobbyState: "LOBBY_STATE",
  LobbyChat: "LOBBY_CHAT",
  LobbyChatHistory: "LOBBY_CHAT_HISTORY",
  LobbyStartGame: "LOBBY_START_GAME",
  LobbyEndGame: "LOBBY_END_GAME",
  LobbyCountdown: "LOBBY_COUNTDOWN",
  LobbyHostTransfer: "LOBBY_HOST_TRANSFER",
  LobbyHeroSelect: "LOBBY_HERO_SELECT",
  LobbyScoreboard: "LOBBY_SCOREBOARD",
  LobbyScoreboardCountdown: "LOBBY_SCOREBOARD_COUNTDOWN",
  LobbyReturnToLobby: "LOBBY_RETURN_TO_LOBBY",
  LobbyKicked: "LOBBY_KICKED",
  LobbyError: "LOBBY_ERROR",
  LobbyEndLobby: "LOBBY_END_LOBBY",

  // Game loading gate
  ClientSceneReady: "CLIENT_SCENE_READY",
  MatchCountdownStart: "MATCH_COUNTDOWN_START",
  MatchGo: "MATCH_GO",

  // Players
  PlayerJoin: "PLAYER_JOIN",
  PlayerLeave: "PLAYER_LEAVE",
  PlayerBatchUpdate: "PLAYER_BATCH_UPDATE",
  GameStateSync: "GAME_STATE_SYNC",
  PlayerDeath: "PLAYER_DEATH",
  PlayerRespawn: "PLAYER_RESPAWN",

  // Abilities
  FireballLaunch: "FIREBALL_LAUNCH",
  FireballImpact: "FIREBALL_IMPACT",
  FireballBatchUpdate: "FIREBALL_BATCH_UPDATE",
  LightningBolt: "LIGHTNING_BOLT",
  PrimaryMeleeAttack: "PRIMARY_MELEE_ATTACK",

  // Shop / economy
  ShopPurchase: "SHOP_PURCHASE",
  ShopState: "SHOP_STATE",
  ShopError: "SHOP_ERROR",
  GoldBalance: "GOLD_BALANCE",
  AssignAbility: "ASSIGN_ABILITY",
  UseQuickItem: "USE_QUICK_ITEM",

  // Input
  PlayerInput: "PLAYER_INPUT",

  // Damage display
  DamageFloat: "DAMAGE_FLOAT",

  // Resync
  RequestResync: "REQUEST_RESYNC",
} as const

export type WsEvent = (typeof WsEvent)[keyof typeof WsEvent]
