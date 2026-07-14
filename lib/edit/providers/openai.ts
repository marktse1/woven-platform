import OpenAI from "openai";
import type { RunnableToolFunctionWithoutParse } from "openai/lib/RunnableFunction";
import type { RunChatParams } from "./types";

export async function runOpenAIChat({ apiKey, model, systemPrompt, history, tools, onEvent }: RunChatParams): Promise<void> {
  const client = new OpenAI({ apiKey });

  // spec.parameters is real JSON Schema, just structurally untyped across the
  // three providers' differing schema-typing libraries — cast at the boundary.
  const runnableTools: RunnableToolFunctionWithoutParse[] = tools.map((spec) => ({
    type: "function",
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters as RunnableToolFunctionWithoutParse["function"]["parameters"],
      function: async (argsJson: string) => spec.execute(JSON.parse(argsJson) as Record<string, unknown>),
    },
  }));

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
  ];

  try {
    const runner = client.chat.completions.runTools({ model, messages, tools: runnableTools, stream: true });
    runner.on("content", (delta) => onEvent({ type: "text", text: delta }));
    await runner.finalChatCompletion();
    onEvent({ type: "done" });
  } catch (e) {
    onEvent({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
}
