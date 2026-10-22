/**
 * AI provider abstraction. SERVER-SIDE ONLY (reads secrets via serverEnv, never imported by client code).
 *
 * Boundaries (docs/AI_FEATURES.md): AI may explain, summarise and suggest using data we pass in. It never
 * picks winners, writes to ledgers, approves evidence, authorises payouts or states prize/impact facts that
 * were not in its input. Every AI path has a deterministic fallback so the product works without any AI.
 */
import { serverEnv } from "../env.ts";

export interface AiProvider {
  readonly name: string;
  complete(input: { system: string; user: string; maxTokens?: number }): Promise<string>;
}

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

export function createAnthropicProvider(opts: { apiKey: string; model: string; timeoutMs: number; fetchImpl?: typeof fetch }): AiProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: "anthropic",
    async complete({ system, user, maxTokens = 400 }) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const res = await doFetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: opts.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
        });
        if (!res.ok) throw new AiError(`provider responded ${res.status}`);
        const json = (await res.json()) as { content?: { type: string; text?: string }[] };
        const text = json.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
        if (!text.trim()) throw new AiError("empty response");
        return text;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw new AiError("provider timed out");
        throw e instanceof AiError ? e : new AiError("provider call failed");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Returns null (=> deterministic fallback) when no provider/credentials are configured. */
export function getAiProvider(): AiProvider | null {
  const name = serverEnv.aiProvider();
  if (name === "anthropic" && serverEnv.aiKey()) {
    return createAnthropicProvider({ apiKey: serverEnv.aiKey(), model: serverEnv.aiModel(), timeoutMs: serverEnv.aiTimeoutMs() });
  }
  return null;
}
