// Emrys Intelligence · Supabase Edge Function (Deno). A lógica está em handler.ts para poder ser testada.
// Secrets necessários: AI_API_KEY (+ AI_PROVIDER, AI_MODEL, ...). Veja o GUIA-IA.txt.
import { handle } from './handler.ts';

Deno.serve((req) => handle(req, Deno.env));
