import { templateExplain } from '../extension/lib/explain.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

// Provider 1: deterministic templates (offline, zero cost) — default, fully tested in Report #2.
export const templateProvider = {
  name: 'template',
  async explain(req) { return templateExplain(req); }
};

// Provider 2: OpenAI-compatible chat-completions endpoint (enabled with LLM_API_KEY).
// Implemented this cycle; live evaluation against a real model is planned for Report #3.
export function makeLlmProvider({ apiKey, baseUrl = 'https://api.openai.com/v1', model = 'gpt-4o-mini', timeoutMs = 10000, fetchImpl = fetch }) {
  return {
    name: `llm:${model}`,
    async explain(req) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserPrompt(req) }] })
        });
        if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
        const data = await res.json();
        const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '');
        if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.items)) throw new Error('LLM output failed schema check');
        // Guard against hallucinated trackers: keep only items whose domain was in the request.
        const allowed = new Set(req.trackers.map(x => x.domain));
        parsed.items = parsed.items.filter(i => allowed.has(i.domain));
        parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
        return parsed;
      } finally { clearTimeout(t); }
    }
  };
}
