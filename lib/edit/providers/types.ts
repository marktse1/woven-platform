import type { EditToolSpec } from "@/lib/edit/tools";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ProviderChatEvent = { type: "text"; text: string } | { type: "done" } | { type: "error"; error: string };

export type RunChatParams = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: ChatTurn[]; // full conversation including the latest user turn
  tools: EditToolSpec[];
  onEvent: (event: ProviderChatEvent) => void;
};

export type Provider = "anthropic" | "openai" | "google";

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
};
