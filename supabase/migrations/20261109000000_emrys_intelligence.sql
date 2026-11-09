-- Emrys Intelligence · histórico de conversas (cada usuário só vê o que é dele)
-- Rode UMA vez em: Supabase > SQL Editor > New query > cole tudo > Run

create table if not exists public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null default 'Nova conversa' check (char_length(title) <= 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.ai_conversations (id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null check (char_length(content) between 1 and 20000),
  created_at       timestamptz not null default now()
);

create index if not exists ai_conversations_user_updated_idx on public.ai_conversations (user_id, updated_at desc);
create index if not exists ai_messages_conv_created_idx      on public.ai_messages (conversation_id, created_at);
create index if not exists ai_messages_user_created_idx      on public.ai_messages (user_id, created_at desc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;

drop policy if exists "ai_conv select own" on public.ai_conversations;
drop policy if exists "ai_conv insert own" on public.ai_conversations;
drop policy if exists "ai_conv update own" on public.ai_conversations;
drop policy if exists "ai_conv delete own" on public.ai_conversations;
create policy "ai_conv select own" on public.ai_conversations for select to authenticated using (auth.uid() = user_id);
create policy "ai_conv insert own" on public.ai_conversations for insert to authenticated with check (auth.uid() = user_id);
create policy "ai_conv update own" on public.ai_conversations for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_conv delete own" on public.ai_conversations for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "ai_msg select own" on public.ai_messages;
drop policy if exists "ai_msg insert own" on public.ai_messages;
drop policy if exists "ai_msg delete own" on public.ai_messages;
create policy "ai_msg select own" on public.ai_messages for select to authenticated using (auth.uid() = user_id);
create policy "ai_msg insert own" on public.ai_messages for insert to authenticated with check (
  auth.uid() = user_id
  and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())
);
create policy "ai_msg delete own" on public.ai_messages for delete to authenticated using (auth.uid() = user_id);

-- sem acesso anônimo; o usuário logado acessa apenas pelas políticas acima
revoke all on public.ai_conversations from anon;
revoke all on public.ai_messages      from anon;
grant select, insert, update, delete on public.ai_conversations to authenticated;
grant select, insert, delete         on public.ai_messages      to authenticated;
