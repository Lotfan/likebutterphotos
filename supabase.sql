create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, created_at timestamptz default now());
create table images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  folder_id uuid references folders on delete set null,
  path text not null, thumb_path text not null, name text, embedding jsonb,
  created_at timestamptz default now());
alter table folders enable row level security;
alter table images enable row level security;
create policy "own folders" on folders for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own images" on images for all using (user_id = auth.uid()) with check (user_id = auth.uid());
insert into storage.buckets (id, name, public) values ('vault', 'vault', false);
create policy "own files" on storage.objects for all to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
