create table if not exists public.package_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  saved_at timestamptz not null default now(),
  file_name text not null,
  headers jsonb not null,
  id_column_index integer not null,
  groups jsonb not null,
  total_packages integer not null check (total_packages >= 0)
);

create index if not exists package_posts_user_saved_at_idx
  on public.package_posts (user_id, saved_at desc);

alter table public.package_posts enable row level security;

create policy "Users can view their own package posts"
  on public.package_posts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own package posts"
  on public.package_posts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own package posts"
  on public.package_posts
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, delete on public.package_posts to authenticated;
