import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { get } from "./db";
import { parseFlow, type Flow } from "./canvas/flow";

/**
 * Per-workspace AI provider, stored as JSON in `workspaces.ai_config`.
 * "openai" means any OpenAI-compatible /chat/completions endpoint — OpenAI,
 * OpenRouter, Groq, Ollama, LM Studio… — picked by `baseUrl`.
 */
export type AiProvider = "anthropic" | "openai";
export type AiConfig = { provider: AiProvider; model: string; baseUrl: string; apiKey: string };
export type ChatTurn = { role: "user" | "assistant"; content: string };

/** What Settings shows an admin: everything but the key itself. */
export type AiSettings = { provider: AiProvider; model: string; baseUrl: string; keyHint: string };
export const aiSettings = (c: AiConfig | null): AiSettings | null =>
  c && { provider: c.provider, model: c.model, baseUrl: c.baseUrl, keyHint: c.apiKey ? `…${c.apiKey.slice(-4)}` : "" };

export const AI_PROVIDERS: AiProvider[] = ["anthropic", "openai"];

// ponytail: API key stored in plain text in Postgres, like the rest of the data; encrypt with a key from env if DB dumps leave the box.
export async function aiConfig(workspaceId: string): Promise<AiConfig | null> {
  const row = await get<{ ai_config: string | null }>("SELECT ai_config FROM workspaces WHERE id = ?", workspaceId);
  return row?.ai_config ? JSON.parse(row.ai_config) : null;
}

const SYSTEM = `You are a business-process assistant inside a collaborative whiteboard.
The user describes a business process; you design it as a flowchart that the app draws on the canvas.

Always answer with ONE JSON object and nothing else:
{"reply": string, "flow": null | {"nodes": [{"id": string, "label": string, "shape": "start"|"end"|"process"|"decision"|"data"}], "edges": [{"from": string, "to": string, "label"?: string}]}}

- "reply": a short message to the user, in the language they wrote in.
- "flow": the flowchart to draw, or null when you are only answering a question or need clarification first.
- Begin with one "start" node and end with at least one "end" node. Use "decision" for yes/no or branching steps and label its outgoing edges (e.g. "Yes"/"No").
- Labels are short verb phrases (max ~6 words). Use 4–25 nodes.
- When the user asks to change a flow you made earlier, return the complete updated flow — it is drawn as a new copy.`;

/** Asks the configured model; returns its reply and, if it designed one, a validated flow. */
export async function askAgent(config: AiConfig, turns: ChatTurn[]): Promise<{ reply: string; flow: Flow | null }> {
  const text = config.provider === "anthropic" ? await askAnthropic(config, turns) : await askOpenAi(config, turns);

  // Models sometimes wrap JSON in prose or ``` fences — take the outermost object.
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(json);
    return { reply: String(parsed.reply ?? ""), flow: parseFlow(parsed.flow) };
  } catch {
    return { reply: text.trim(), flow: null };
  }
}

async function askAnthropic(config: AiConfig, turns: ChatTurn[]) {
  const client = new Anthropic({ apiKey: config.apiKey });
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: turns,
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

async function askOpenAi(config: AiConfig, turns: ChatTurn[]) {
  const base = (config.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model: config.model, messages: [{ role: "system", content: SYSTEM }, ...turns] }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  // Only the provider's own error message goes back to the browser, never the raw body:
  // the base URL is admin-set, so the response may come from anywhere.
  if (!res.ok) throw new Error(`Provider returned ${res.status}${body?.error?.message ? `: ${String(body.error.message).slice(0, 300)}` : ""}`);
  return String(body?.choices?.[0]?.message?.content ?? "");
}
