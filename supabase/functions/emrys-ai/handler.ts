import { loadProvider, type Env } from './providers/index.ts';
import { ProviderError, type ChatMessage } from './providers/types.ts';
import { DEFAULT_SYSTEM_PROMPT } from './prompt.ts';

/* Limites (ajustáveis por secret). Mantêm o uso dentro do plano gratuito e evitam abuso. */
const MAX_MESSAGE_CHARS = 4000;       // tamanho máximo de uma mensagem do usuário
const MAX_HISTORY_MESSAGES = 20;      // quantas mensagens anteriores vão para a IA
const MAX_HISTORY_CHARS = 24000;      // teto de caracteres de histórico enviado
const AI_TIMEOUT_MS = 50_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Json = Record<string, unknown>;

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const allowed = (env.get('ALLOWED_ORIGINS') || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin') || '';
  const h: Record<string, string> = {
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
  if (allowed.includes('*')) h['access-control-allow-origin'] = '*';
  else if (allowed.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

function reply(req: Request, env: Env, status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req, env), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
const fail = (req: Request, env: Env, status: number, error: string, message: string) => reply(req, env, status, { error, message });

function intEnv(env: Env, name: string, def: number, min: number, max: number): number {
  const n = parseInt(env.get(name) || '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  if (req.method !== 'POST') return fail(req, env, 405, 'method_not_allowed', 'use POST.');

  /* 1 · quem é o usuário? (token do Supabase Auth enviado pelo app) */
  const auth = req.headers.get('authorization') || '';
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1] || '';
  const apikey = req.headers.get('apikey') || env.get('SUPABASE_ANON_KEY') || '';
  const base = (env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  if (!token || !apikey || !base) return fail(req, env, 401, 'unauthorized', 'entre na sua conta para usar o Emrys Intelligence.');

  const api = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    fetch(base + path, { method, headers: { apikey, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });

  let userId = '';
  try {
    const r = await fetch(base + '/auth/v1/user', { headers: { apikey, authorization: `Bearer ${token}` } });
    if (!r.ok) return fail(req, env, 401, 'unauthorized', 'sessão inválida ou expirada. entre de novo.');
    userId = String((await r.json())?.id || '');
  } catch { return fail(req, env, 502, 'auth_unavailable', 'não consegui validar o login agora. tente de novo.'); }
  if (!UUID.test(userId)) return fail(req, env, 401, 'unauthorized', 'sessão inválida.');

  /* 2 · valida o pedido */
  let input: { conversation_id?: unknown; message?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_MESSAGE_CHARS * 3) return fail(req, env, 413, 'too_long', 'pedido grande demais.');
    input = JSON.parse(raw);
  } catch { return fail(req, env, 400, 'bad_request', 'pedido inválido.'); }
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message) return fail(req, env, 400, 'bad_request', 'escreva uma mensagem.');
  if (message.length > MAX_MESSAGE_CHARS) return fail(req, env, 413, 'too_long', `a mensagem passa de ${MAX_MESSAGE_CHARS} caracteres. encurte ou divida.`);
  const convIn = input.conversation_id == null || input.conversation_id === '' ? null : String(input.conversation_id);
  if (convIn && !UUID.test(convIn)) return fail(req, env, 400, 'bad_request', 'conversa inválida.');

  /* 3 · o provedor está configurado? */
  let provider;
  try { provider = loadProvider(env); }
  catch (e) { console.error('[emrys-ai] configuração:', (e as Error).message); return fail(req, env, 500, 'ai_config', 'o Emrys Intelligence ainda não foi configurado no servidor.'); }

  /* 4 · limite diário por usuário (conta só o que ficou gravado, então o cliente não consegue burlar) */
  const limit = intEnv(env, 'AI_DAILY_LIMIT', 60, 1, 100000);
  const since = new Date(Date.now() - 86400000).toISOString();
  let used = 0;
  try {
    const r = await api('GET', `/rest/v1/ai_messages?select=id&role=eq.user&created_at=gte.${encodeURIComponent(since)}&limit=1`, undefined, { prefer: 'count=exact', 'range-unit': 'items', range: '0-0' });
    if (r.status === 404 || r.status === 400) { console.error('[emrys-ai] tabelas ausentes:', (await r.text()).slice(0, 200)); return fail(req, env, 500, 'db_setup', 'as tabelas do histórico ainda não existem no Supabase. rode o SQL do guia.'); }
    if (!r.ok && r.status !== 206) throw new Error('status ' + r.status);
    used = parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;
  } catch (e) { console.error('[emrys-ai] limite:', (e as Error).message); return fail(req, env, 502, 'db_unavailable', 'não consegui acessar o histórico agora. tente de novo.'); }
  if (used >= limit) return fail(req, env, 429, 'rate_limited', `limite diário de ${limit} mensagens atingido. volte amanhã.`);

  /* 5 · conversa (existente do próprio usuário, ou nova) + histórico */
  let convId = convIn, title = '', history: ChatMessage[] = [];
  try {
    if (convId) {
      const r = await api('GET', `/rest/v1/ai_conversations?id=eq.${convId}&select=id,title`);
      const rows = r.ok ? await r.json() : [];
      if (!rows.length) return fail(req, env, 404, 'conversation_not_found', 'essa conversa não existe mais.');
      title = String(rows[0].title || '');
      const hr = await api('GET', `/rest/v1/ai_messages?conversation_id=eq.${convId}&select=role,content&order=created_at.desc&limit=${MAX_HISTORY_MESSAGES}`);
      const hrows: ChatMessage[] = hr.ok ? await hr.json() : [];
      history = hrows.reverse().filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
      while (history.length && history[0].role !== 'user') history.shift();
      let total = history.reduce((n, m) => n + m.content.length, 0);
      while (history.length > 1 && total > MAX_HISTORY_CHARS) { total -= history.shift()!.content.length; while (history.length && history[0].role !== 'user') total -= history.shift()!.content.length; }
    }
  } catch (e) { console.error('[emrys-ai] histórico:', (e as Error).message); return fail(req, env, 502, 'db_unavailable', 'não consegui carregar a conversa. tente de novo.'); }

  /* 6 · chama a IA */
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  let answer = '', model = '';
  try {
    const out = await provider.chat({
      system: env.get('AI_SYSTEM_PROMPT') || DEFAULT_SYSTEM_PROMPT,
      messages: [...history, { role: 'user', content: message }],
      maxTokens: intEnv(env, 'AI_MAX_TOKENS', 1024, 64, 8192),
      temperature: Math.min(1.5, Math.max(0, parseFloat(env.get('AI_TEMPERATURE') || '0.7') || 0.7)),
      signal: ctrl.signal,
    });
    answer = out.text.slice(0, 19000); model = out.model;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return fail(req, env, 504, 'ai_timeout', 'a IA demorou demais para responder. tente de novo.');
    if (e instanceof ProviderError) {
      console.error('[emrys-ai] provedor', provider.name, e.kind, e.detail);
      if (e.kind === 'rate_limit') return fail(req, env, 503, 'ai_busy', 'a IA está no limite do plano gratuito agora. tente de novo em alguns minutos.');
      if (e.kind === 'empty') return fail(req, env, 502, 'ai_empty', 'a IA não devolveu resposta (ela pode ter bloqueado o assunto). tente reformular.');
      if (e.kind === 'auth' || e.kind === 'bad_request') return fail(req, env, 500, 'ai_config', 'o servidor não conseguiu usar o provedor de IA (chave ou modelo inválidos). avise o administrador.');
      return fail(req, env, 502, 'ai_unavailable', 'o serviço de IA está indisponível. tente de novo.');
    }
    console.error('[emrys-ai] falha:', (e as Error).message);
    return fail(req, env, 502, 'ai_unavailable', 'o serviço de IA está indisponível. tente de novo.');
  } finally { clearTimeout(timer); }

  /* 7 · grava a troca (sempre depois do sucesso da IA) */
  const now = Date.now(); let saved = true;
  try {
    if (!convId) {
      title = message.replace(/\s+/g, ' ').slice(0, 48).trim() || 'Nova conversa';
      const r = await api('POST', '/rest/v1/ai_conversations', { title }, { prefer: 'return=representation' });
      if (!r.ok) throw new Error('criar conversa: ' + r.status);
      convId = String((await r.json())[0].id);
    }
    const r = await api('POST', '/rest/v1/ai_messages', [
      { conversation_id: convId, role: 'user', content: message, created_at: new Date(now).toISOString() },
      { conversation_id: convId, role: 'assistant', content: answer, created_at: new Date(now + 1).toISOString() },
    ], { prefer: 'return=minimal' });
    if (!r.ok) throw new Error('gravar mensagens: ' + r.status);
    await api('PATCH', `/rest/v1/ai_conversations?id=eq.${convId}`, { updated_at: new Date(now + 2).toISOString() }, { prefer: 'return=minimal' });
  } catch (e) { saved = false; console.error('[emrys-ai] gravação:', (e as Error).message); }

  return reply(req, env, 200, { conversation_id: convId, title, reply: { content: answer, created_at: new Date(now + 1).toISOString() }, saved, model, remaining: Math.max(0, limit - used - 1) });
}
