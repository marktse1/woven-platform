import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { RunChatParams } from "./types";

export async function runAnthropicChat({ apiKey, model, systemPrompt, history, tools, onEvent }: RunChatParams): Promise<void> {
  const client = new Anthropic({ apiKey });

  // spec.parameters is real JSON Schema, just structurally untyped across the
  // three providers' differing schema-typing libraries — cast at the boundary.
  const runnerTools = tools.map((spec) =>
    betaTool({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.parameters as Parameters<typeof betaTool>[0]["inputSchema"],
      run: async (args) => spec.execute(args as Record<string, unknown>),
    }),
  );

  const messages = history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.Beta.BetaMessageParam);

  try {
    const runner = client.beta.messages.toolRunner({
      model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: systemPrompt,
      tools: runnerTools,
      messages,
      stream: true,
    });

    for await (const messageStream of runner) {
      for await (const event of messageStream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          onEvent({ type: "text", text: event.delta.text });
        }
      }
    }
    onEvent({ type: "done" });
  } catch (e) {
    onEvent({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
}
