import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { get } from "./db";
import { parseFlow, type Flow } from "./canvas/flow";

/**
 * Per-workspace AI provider, stored as JSON in `workspaces.ai_config`.
 * "openai" means any OpenAI-compatible /chat/completions endpoint — OpenAI,
 * OpenRouter, Groq, Ollama, LM Studio… — picked by `baseUrl`. "gemini" is the
 * same protocol at Google's fixed OpenAI-compatible endpoint.
 */
export type AiProvider = "anthropic" | "openai" | "gemini";
/** "" = let the provider decide (and send nothing, so models without the knob don't reject it). */
export type Reasoning = "" | "low" | "medium" | "high";
export const REASONING: Reasoning[] = ["", "low", "medium", "high"];
export type AiConfig = { provider: AiProvider; model: string; baseUrl: string; apiKey: string; reasoning?: Reasoning };

/** Configs saved before reasoning was a setting kept Gemini on "low", which used to be hardcoded. */
export const reasoningOf = (c: AiConfig): Reasoning => c.reasoning ?? (c.provider === "gemini" ? "low" : "");
export type ChatTurn = { role: "user" | "assistant"; content: string };

/** What Settings shows an admin: everything but the key itself. */
export type AiSettings = { provider: AiProvider; model: string; baseUrl: string; keyHint: string; reasoning: Reasoning };
export const aiSettings = (c: AiConfig | null): AiSettings | null =>
  c && { provider: c.provider, model: c.model, baseUrl: c.baseUrl, keyHint: c.apiKey ? `…${c.apiKey.slice(-4)}` : "", reasoning: reasoningOf(c) };

const PROVIDER_NAME: Record<AiProvider, string> = { anthropic: "Anthropic", openai: "OpenAI-compatible", gemini: "Gemini" };
/** "Gemini · gemini-3.8-flash · reasoning: low" — stamped on the canvas next to what the agent drew. */
export const agentLabel = (c: AiConfig) => `${PROVIDER_NAME[c.provider]} · ${c.model} · reasoning: ${reasoningOf(c) || "default"}`;

export const AI_PROVIDERS: AiProvider[] = ["anthropic", "openai", "gemini"];
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

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
- Answer with language-appropriate punctuation and capitalization that match the requested language (DO NOT ANSWER IN DIFFERENT LANGUAGE FROM THE REQUESTED/PROMPT LANGUAGE).
- When the user asks to change a flow you made earlier, return the complete updated flow — it is drawn as a new copy.`;

// Overloaded / rate-limited / flaky gateway: worth another try.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Asks the configured model; returns its reply and, if it designed one, a validated flow.
 * Retries overloads itself (the Anthropic SDK's own retries are off) so `onStatus` can say so.
 */
export async function askAgent(
  config: AiConfig,
  turns: ChatTurn[],
  onStatus: (text: string) => void = () => {},
): Promise<{ reply: string; flow: Flow | null }> {
  let text = "";
  for (let attempt = 0; ; attempt++) {
    try {
      text = config.provider === "anthropic" ? await askAnthropic(config, turns) : await askOpenAi(config, turns);
      break;
    } catch (error) {
      const status = error instanceof ProviderError || error instanceof Anthropic.APIError ? error.status : undefined;
      if (!status || !RETRYABLE.has(status) || attempt >= RETRY_DELAYS_MS.length) throw error;
      const wait = RETRY_DELAYS_MS[attempt];
      onStatus(`${config.model} ${status === 429 ? "is rate-limited" : "is busy"} (${status}) — retrying in ${wait / 1000}s (${attempt + 1}/${RETRY_DELAYS_MS.length})…`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      onStatus(`Retrying ${config.model}…`);
    }
  }

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
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 0 });
  const effort = reasoningOf(config);
  const response = await client.messages.create({
    model: config.model,
    ...(effort ? { output_config: { effort } } : {}),
    max_tokens: 16000,
    system: SYSTEM,
    messages: turns,
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

const openAiBase = (config: AiConfig) =>
  (config.provider === "gemini" ? GEMINI_URL : config.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
const openAiAuth = (config: AiConfig): Record<string, string> => (config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {});

// Only the provider's own error message goes back to the browser, never the raw body:
// the base URL is admin-set, so the response may come from anywhere. Gemini wraps it in an array.
class ProviderError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function providerError(status: number, body: unknown) {
  const message = (Array.isArray(body) ? body[0] : (body as { error?: { message?: unknown } }))?.error?.message;
  return new ProviderError(`Provider returned ${status}${message ? `: ${String(message).slice(0, 300)}` : ""}`, status);
}

// Not chat models; OpenAI and Gemini list them alongside the rest.
const NOT_CHAT = /embed|tts|whisper|dall-e|image|imagen|veo|moderation|audio|transcribe|realtime|aqa|search|computer-use|davinci|babbage/i;

/** The models this key can use, newest/most relevant first as the provider orders them. */
export async function listModels(config: AiConfig): Promise<string[]> {
  if (config.provider === "anthropic") {
    const ids: string[] = [];
    for await (const model of new Anthropic({ apiKey: config.apiKey }).models.list()) ids.push(model.id);
    return ids;
  }
  const res = await fetch(`${openAiBase(config)}/models`, { headers: openAiAuth(config), signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw providerError(res.status, body);
  return (Array.isArray(body?.data) ? body.data : [])
    .map((m: { id?: unknown }) => String(m?.id ?? "").replace(/^models\//, ""))
    .filter((id: string) => id && !NOT_CHAT.test(id));
}

// ponytail: per-process cache; each instance asks the provider at most every 10 min.
const modelCache = new Map<string, { at: number; config: string; models: string[] }>();

/** The saved key's models, for the chat panel's picker and to vet a requested override. */
export async function workspaceModels(workspaceId: string, config: AiConfig) {
  const stamp = JSON.stringify(config);
  const hit = modelCache.get(workspaceId);
  if (hit && hit.config === stamp && Date.now() - hit.at < 600_000) return hit.models;
  const models = await listModels(config);
  modelCache.set(workspaceId, { at: Date.now(), config: stamp, models });
  return models;
}

async function askOpenAi(config: AiConfig, turns: ChatTurn[]) {
  const res = await fetch(`${openAiBase(config)}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...openAiAuth(config) },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "system", content: SYSTEM }, ...turns],
      // Thinking is most of the wait on Gemini 3 and OpenAI's reasoning models; non-reasoning models reject the field.
      ...(reasoningOf(config) ? { reasoning_effort: reasoningOf(config) } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw providerError(res.status, body);
  return String(body?.choices?.[0]?.message?.content ?? "");
}
