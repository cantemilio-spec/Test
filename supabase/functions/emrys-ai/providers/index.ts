import { anthropic } from './anthropic.ts';
import { gemini } from './gemini.ts';
import { openaiCompatible } from './openai.ts';
import type { AIProvider } from './types.ts';

export type Env = { get(name: string): string | undefined };

/** Registro de provedores. Para adicionar um: crie providers/meu.ts e acrescente uma linha aqui. */
const REGISTRY: Record<string, (cfg: { apiKey: string; model: string; baseUrl?: string }) => AIProvider> = {
  gemini,
  openai: openaiCompatible,        // também serve Groq, OpenRouter etc. (AI_BASE_URL)
  anthropic,
};
const DEFAULT_MODEL: Record<string, string> = { gemini: 'gemini-2.5-flash' };

export function loadProvider(env: Env): AIProvider {
  const name = (env.get('AI_PROVIDER') || 'gemini').toLowerCase();
  const make = REGISTRY[name];
  if (!make) throw new Error(`AI_PROVIDER inválido: "${name}". Use: ${Object.keys(REGISTRY).join(', ')}`);
  const apiKey = env.get('AI_API_KEY');
  if (!apiKey) throw new Error('secret AI_API_KEY não configurado');
  const model = env.get('AI_MODEL') || DEFAULT_MODEL[name];
  if (!model) throw new Error(`secret AI_MODEL não configurado (obrigatório para "${name}")`);
  return make({ apiKey, model, baseUrl: env.get('AI_BASE_URL') || undefined });
}
