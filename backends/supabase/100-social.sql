-- Application schema only. Fixture accounts and data are seeded through native APIs.
create table public.posts (
 id uuid primary key default gen_random_uuid(),
 author uuid not null references auth.users(id) on delete cascade,
 title text not null check (length(title) between 1 and 200),
 body text not null check (length(body) between 1 and 4096),
 created_at bigint not null default floor(extract(epoch from clock_timestamp())),
 updated_at bigint not null default floor(extract(epoch from clock_timestamp()))
);
create index idx_posts_feed on public.posts(created_at desc,id desc);
create index idx_posts_own on public.posts(author,created_at desc,id desc);
create table public.likes (
 id uuid primary key default gen_random_uuid(),
 "user" uuid not null references auth.users(id) on delete cascade,
 post uuid not null references public.posts(id) on delete cascade,
 unique("user",post)
);
-- Cascading deletion also searches by post when its author deletes a post/account.
create index idx_likes_post on public.likes(post);
alter table public.posts enable row level security;
alter table public.likes enable row level security;
grant select on public.posts to anon,authenticated;
grant insert,update,delete on public.posts to authenticated;
grant select,insert,delete on public.likes to authenticated;
create policy posts_public on public.posts for select using (true);
create policy posts_create on public.posts for insert to authenticated with check (author=(select auth.uid()));
create policy posts_update on public.posts for update to authenticated using(author=(select auth.uid())) with check(author=(select auth.uid()));
create policy posts_delete on public.posts for delete to authenticated using(author=(select auth.uid()));
create policy likes_own on public.likes for select to authenticated using("user"=(select auth.uid()));
create policy likes_create on public.likes for insert to authenticated with check("user"=(select auth.uid()));
create policy likes_delete on public.likes for delete to authenticated using("user"=(select auth.uid()));
create function public.stamp_post() returns trigger language plpgsql set search_path='' as $$
begin
 if new.author<>old.author then raise exception 'Author is immutable' using errcode='42501';end if;
 new.created_at=old.created_at;
 new.updated_at=floor(extract(epoch from clock_timestamp()));return new;
end $$;
create trigger stamp_post before update on public.posts for each row execute function public.stamp_post();
-- Native authenticated app endpoint; never distribute a service-role key to the generator.
create function public.delete_own_account() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 delete from auth.users where id=auth.uid();
end $$;
revoke all on function public.delete_own_account() from public,anon;
grant execute on function public.delete_own_account() to authenticated;
notify pgrst,'reload schema';
