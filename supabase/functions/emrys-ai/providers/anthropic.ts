import { type AIProvider, type ChatRequest, type ChatResult, mapStatus, type ProviderConfig, ProviderError } from './types.ts';

/** Anthropic (Claude). Pago: precisa de crédito na conta da API. */
export function anthropic(cfg: ProviderConfig): AIProvider {
  const base = (cfg.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  return {
    name: 'anthropic',
    async chat(req: ChatRequest): Promise<ChatResult> {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        signal: req.signal,
        body: JSON.stringify({ model: cfg.model, system: req.system, messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature }),
      });
      if (!res.ok) { const e = mapStatus(res.status); e.detail = (await res.text()).slice(0, 300); throw e; }
      const j = await res.json();
      const text = Array.isArray(j?.content) ? j.content.filter((b: { type?: string }) => b.type === 'text').map((b: { text?: string }) => b.text || '').join('').trim() : '';
      if (!text) throw new ProviderError('empty', String(j?.stop_reason || ''));
      return { text, model: String(j?.model || cfg.model) };
    },
  };
}
