import { type AIProvider, type ChatRequest, type ChatResult, mapStatus, type ProviderConfig, ProviderError } from './types.ts';

/** Qualquer serviço "compatível com OpenAI" (/chat/completions): OpenAI, Groq, OpenRouter, Together, Mistral…
 *  Escolha o serviço com AI_BASE_URL, por exemplo:
 *    Groq        → https://api.groq.com/openai/v1
 *    OpenRouter  → https://openrouter.ai/api/v1
 *    OpenAI      → https://api.openai.com/v1  (padrão) */
export function openaiCompatible(cfg: ProviderConfig): AIProvider {
  const base = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    name: 'openai',
    async chat(req: ChatRequest): Promise<ChatResult> {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        signal: req.signal,
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
          max_tokens: req.maxTokens,
          temperature: req.temperature,
        }),
      });
      if (!res.ok) { const e = mapStatus(res.status); e.detail = (await res.text()).slice(0, 300); throw e; }
      const j = await res.json();
      const text = String(j?.choices?.[0]?.message?.content || '').trim();
      if (!text) throw new ProviderError('empty', String(j?.choices?.[0]?.finish_reason || ''));
      return { text, model: String(j?.model || cfg.model) };
    },
  };
}
