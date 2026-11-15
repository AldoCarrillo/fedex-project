create table if not exists public.history_key_aliases (
  key_hash text primary key,
  owner_key_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists history_key_aliases_owner_idx
  on public.history_key_aliases (owner_key_hash);

create table if not exists public.history_pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  pin_hash text not null unique,
  owner_key_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists history_pairing_sessions_expiry_idx
  on public.history_pairing_sessions (expires_at);

create table if not exists public.history_pairing_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.history_pairing_sessions (id) on delete cascade,
  request_token_hash text not null unique,
  new_key_hash text not null unique,
  verification_code text not null check (verification_code ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz
);

create index if not exists history_pairing_requests_session_created_idx
  on public.history_pairing_requests (session_id, created_at);

alter table public.history_key_aliases enable row level security;
alter table public.history_pairing_sessions enable row level security;
alter table public.history_pairing_requests enable row level security;

revoke all on public.history_key_aliases, public.history_pairing_sessions,
  public.history_pairing_requests from anon, authenticated;
grant select, insert, update, delete on public.history_key_aliases,
  public.history_pairing_sessions, public.history_pairing_requests to service_role;

create or replace function public.request_history_pairing(
  p_pin_hash text,
  p_request_token_hash text,
  p_new_key_hash text,
  p_verification_code text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  pairing_session public.history_pairing_sessions%rowtype;
  pending_count integer;
  request_id uuid;
begin
  select * into pairing_session
  from public.history_pairing_sessions
  where pin_hash = p_pin_hash and expires_at > now()
  for update;

  if not found then
    return null;
  end if;

  select count(*) into pending_count
  from public.history_pairing_requests
  where session_id = pairing_session.id
    and approved_at is null
    and rejected_at is null;

  if pending_count >= 5 then
    return null;
  end if;

  insert into public.history_pairing_requests (
    session_id, request_token_hash, new_key_hash, verification_code
  )
  values (
    pairing_session.id, p_request_token_hash, p_new_key_hash, p_verification_code
  )
  returning id into request_id;

  return request_id;
end;
$$;

create or replace function public.approve_history_pairing(
  p_request_id uuid,
  p_owner_key_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  pairing_request public.history_pairing_requests%rowtype;
  pairing_owner_hash text;
begin
  select r.* into pairing_request
  from public.history_pairing_requests r
  join public.history_pairing_sessions s on s.id = r.session_id
  where r.id = p_request_id
    and s.owner_key_hash = p_owner_key_hash
    and s.expires_at > now()
    and r.approved_at is null
    and r.rejected_at is null
  for update of r;

  if not found then
    return false;
  end if;

  select owner_key_hash into pairing_owner_hash
  from public.history_pairing_sessions
  where id = pairing_request.session_id;

  insert into public.history_key_aliases (key_hash, owner_key_hash)
  values (pairing_request.new_key_hash, pairing_owner_hash);

  update public.history_pairing_requests
  set approved_at = now()
  where id = pairing_request.id;

  return true;
end;
$$;

revoke all on function public.request_history_pairing(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.approve_history_pairing(uuid, text)
  from public, anon, authenticated;
grant execute on function public.request_history_pairing(text, text, text, text)
  to service_role;
grant execute on function public.approve_history_pairing(uuid, text)
  to service_role;
