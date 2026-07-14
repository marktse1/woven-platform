import type { Provider, RunChatParams } from "./types";
import { runAnthropicChat } from "./anthropic";
import { runOpenAIChat } from "./openai";
import { runGoogleChat } from "./google";

export { DEFAULT_MODEL } from "./types";
export type { Provider, ChatTurn, ProviderChatEvent } from "./types";

export async function runProviderChat(provider: Provider, params: RunChatParams): Promise<void> {
  if (provider === "anthropic") return runAnthropicChat(params);
  if (provider === "openai") return runOpenAIChat(params);
  return runGoogleChat(params);
}
