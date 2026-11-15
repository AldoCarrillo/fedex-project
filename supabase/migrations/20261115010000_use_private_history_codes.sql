drop policy if exists "Users can view their own package posts" on public.package_posts;
drop policy if exists "Users can create their own package posts" on public.package_posts;
drop policy if exists "Users can delete their own package posts" on public.package_posts;

alter table public.package_posts
  drop constraint if exists package_posts_user_id_fkey;

alter table public.package_posts
  alter column user_id drop not null;

alter table public.package_posts
  add column if not exists owner_key_hash text;

create index if not exists package_posts_owner_saved_at_idx
  on public.package_posts (owner_key_hash, saved_at desc);

revoke all on public.package_posts from anon, authenticated;
grant select, insert, delete on public.package_posts to service_role;
