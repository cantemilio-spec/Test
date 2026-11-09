import { type AIProvider, type ChatRequest, type ChatResult, mapStatus, type ProviderConfig, ProviderError } from './types.ts';

/** Google Gemini (tem plano gratuito no Google AI Studio). */
export function gemini(cfg: ProviderConfig): AIProvider {
  const base = (cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  return {
    name: 'gemini',
    async chat(req: ChatRequest): Promise<ChatResult> {
      const res = await fetch(`${base}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        signal: req.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: req.maxTokens, temperature: req.temperature },
        }),
      });
      if (!res.ok) { const e = mapStatus(res.status); e.detail = (await res.text()).slice(0, 300); throw e; }
      const j = await res.json();
      const parts = j?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text || '').join('').trim() : '';
      if (!text) throw new ProviderError('empty', JSON.stringify(j?.promptFeedback || j?.candidates?.[0]?.finishReason || '').slice(0, 200));
      return { text, model: cfg.model };
    },
  };
}
