/** Contrato que todo provedor de IA precisa cumprir. Para trocar de provedor, crie um arquivo novo aqui
 *  que implemente `AIProvider` e registre-o em providers/index.ts. O resto do sistema não muda. */
export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];      // histórico + a mensagem nova (a última é sempre do usuário)
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}

export interface ChatResult { text: string; model: string }

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;             // opcional: provedores compatíveis ou testes
}

export interface AIProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResult>;
}

/** Erro "seguro" do provedor: a mensagem pode ser mostrada ao usuário, os detalhes só vão para o log. */
export class ProviderError extends Error {
  constructor(public kind: 'rate_limit' | 'auth' | 'bad_request' | 'unavailable' | 'empty', public detail = '') {
    super(kind);
  }
}

export function mapStatus(status: number): ProviderError {
  if (status === 429) return new ProviderError('rate_limit');
  if (status === 401 || status === 403) return new ProviderError('auth');
  if (status === 400 || status === 404 || status === 422) return new ProviderError('bad_request');
  return new ProviderError('unavailable');
}
