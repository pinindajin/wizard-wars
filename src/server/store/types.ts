import type { ChatMessage } from "../../shared/types"

/** Interface for persisting and retrieving chat logs. */
export type ChatStore = {
  readonly saveChatLog: (messages: ChatMessage[]) => Promise<void>
  readonly getLatestChatLog: () => Promise<ChatMessage[] | null>
  readonly deleteOldLogs: () => Promise<void>
}
