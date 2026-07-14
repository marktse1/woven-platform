import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import type { RunChatParams } from "./types";

// No built-in tool-runner helper for Gemini (unlike Anthropic's toolRunner
// or OpenAI's runTools) — hand-rolled agentic loop. Per @google/genai's own
// type docs, function-call arguments arrive whole per call in the Gemini
// Developer API (not streamed as partial JSON like OpenAI's deltas), so no
// delta-accumulation is needed for tool args, only for text.
const MAX_TURNS = 10;

export async function runGoogleChat({ apiKey, model, systemPrompt, history, tools, onEvent }: RunChatParams): Promise<void> {
  const ai = new GoogleGenAI({ apiKey });

  const functionDeclarations: FunctionDeclaration[] = tools.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parametersJsonSchema: spec.parameters,
  }));
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const contents: Content[] = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: { systemInstruction: systemPrompt, tools: [{ functionDeclarations }] },
      });

      let turnText = "";
      const collectedCalls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
      for await (const chunk of stream) {
        if (chunk.text) {
          turnText += chunk.text;
          onEvent({ type: "text", text: chunk.text });
        }
        for (const call of chunk.functionCalls ?? []) {
          if (call.name) collectedCalls.push({ id: call.id, name: call.name, args: call.args ?? {} });
        }
      }

      contents.push({ role: "model", parts: turnText ? [{ text: turnText }] : collectedCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) });

      if (collectedCalls.length === 0) {
        onEvent({ type: "done" });
        return;
      }

      const resultParts = [];
      for (const call of collectedCalls) {
        const spec = toolsByName.get(call.name);
        const result = spec ? await spec.execute(call.args) : `Error: unknown tool ${call.name}`;
        resultParts.push({ functionResponse: { id: call.id, name: call.name, response: { output: result } } });
      }
      contents.push({ role: "user", parts: resultParts });
    }
    onEvent({ type: "error", error: "Reached the maximum number of tool-call turns without finishing" });
  } catch (e) {
    onEvent({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
}
