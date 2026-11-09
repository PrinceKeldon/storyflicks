-- Creator-managed Trash, restore and guarded purge.
-- Published content is withdrawn, never physically removed by a normal delete action.

alter table public.stories
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_from_status text;

alter table public.episodes
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_from_status text;

alter table public.story_material_sections
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_from_status text;

-- A trashed episode no longer occupies its chapter number. Restore checks the
-- active sequence before reactivating it, so another chapter is never displaced.
alter table public.episodes
  drop constraint if exists episodes_story_id_sequence_number_key;

create unique index if not exists episodes_story_sequence_active_idx
  on public.episodes(story_id, sequence_number)
  where deleted_at is null;

create index if not exists stories_deleted_at_idx
  on public.stories(deleted_at) where deleted_at is not null;
create index if not exists episodes_deleted_at_idx
  on public.episodes(story_id, deleted_at) where deleted_at is not null;
create index if not exists story_material_sections_deleted_at_idx
  on public.story_material_sections(story_id, deleted_at) where deleted_at is not null;

create table if not exists public.creator_content_audit (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('story','episode','material','revision')),
  entity_id uuid not null,
  entity_title text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('deleted','restored','purged','draft_revision_deleted')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.creator_content_audit enable row level security;
revoke all on public.creator_content_audit from public, anon, authenticated;
grant all on public.creator_content_audit to service_role;

create or replace function public.creator_delete_story(p_story_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_story public.stories%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.creator_profiles where id=v_user and status='active') then raise exception 'An active creator profile is required'; end if;
  if not exists(select 1 from public.creator_profiles where id=v_user and status='active') then
    raise exception 'An active creator profile is required';
  end if;
  if not exists(select 1 from public.story_creators where story_id=p_story_id and creator_id=v_user and role in ('owner','author','editor')) then
    raise exception 'You do not have permission to manage this story';
  end if;
  select * into v_story from public.stories where id=p_story_id for update;
  if not found then raise exception 'Story not found'; end if;
  if v_story.deleted_at is not null then
    return jsonb_build_object('story_id',p_story_id,'status','already_deleted');
  end if;
  update public.stories set deleted_at=now(),deleted_by=v_user,deleted_from_status=publication_status,publication_status='draft',updated_at=now() where id=p_story_id;
  insert into public.creator_content_audit(entity_type,entity_id,entity_title,actor_id,action,details)
  values('story',p_story_id,v_story.title,v_user,'deleted',jsonb_build_object('previous_status',v_story.publication_status));
  return jsonb_build_object('story_id',p_story_id,'status','deleted');
end $$;

create or replace function public.creator_restore_story(p_story_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_story public.stories%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.story_creators where story_id=p_story_id and creator_id=v_user and role in ('owner','author','editor')) then
    raise exception 'You do not have permission to manage this story';
  end if;
  select * into v_story from public.stories where id=p_story_id and deleted_at is not null for update;
  if not found then raise exception 'Trashed story not found'; end if;
  update public.stories set deleted_at=null,deleted_by=null,publication_status='draft',deleted_from_status=null,updated_at=now() where id=p_story_id;
  insert into public.creator_content_audit(entity_type,entity_id,entity_title,actor_id,action)
  values('story',p_story_id,v_story.title,v_user,'restored');
  return jsonb_build_object('story_id',p_story_id,'status','restored');
end $$;

create or replace function public.creator_delete_episode(p_episode_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_episode public.episodes%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select e.* into v_episode from public.episodes e
  join public.story_creators sc on sc.story_id=e.story_id
  where e.id=p_episode_id and sc.creator_id=v_user and sc.role in ('owner','author','editor')
  for update of e;
  if not found then raise exception 'Episode not found or you do not have permission to manage it'; end if;
  if v_episode.deleted_at is not null then
    return jsonb_build_object('episode_id',p_episode_id,'status','already_deleted');
  end if;
  delete from public.episode_publication_queue where episode_id=p_episode_id;
  update public.episodes set deleted_at=now(),deleted_by=v_user,deleted_from_status=publication_status,publication_status='withdrawn',scheduled_at=null,updated_at=now() where id=p_episode_id;
  insert into public.creator_content_audit(entity_type,entity_id,entity_title,actor_id,action,details)
  values('episode',p_episode_id,v_episode.title,v_user,'deleted',jsonb_build_object('story_id',v_episode.story_id,'sequence_number',v_episode.sequence_number,'previous_status',v_episode.publication_status));
  return jsonb_build_object('episode_id',p_episode_id,'status','deleted','sequence_number_released',v_episode.sequence_number);
end $$;

create or replace function public.creator_restore_episode(p_episode_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_episode public.episodes%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select e.* into v_episode from public.episodes e
  join public.story_creators sc on sc.story_id=e.story_id
  where e.id=p_episode_id and e.deleted_at is not null and sc.creator_id=v_user and sc.role in ('owner','author','editor')
  for update of e;
  if not found then raise exception 'Trashed episode not found or you do not have permission to restore it'; end if;
  if exists(select 1 from public.episodes active where active.story_id=v_episode.story_id and active.sequence_number=v_episode.sequence_number and active.deleted_at is null and active.id<>p_episode_id) then
    raise exception 'Chapter number % is already in use. Move or delete the active chapter before restoring this item.',v_episode.sequence_number;
  end if;
  update public.episodes set deleted_at=null,deleted_by=null,publication_status='draft',deleted_from_status=null,updated_at=now() where id=p_episode_id;
  insert into public.creator_content_audit(entity_type,entity_id,entity_title,actor_id,action,details)
  values('episode',p_episode_id,v_episode.title,v_user,'restored',jsonb_build_object('sequence_number',v_episode.sequence_number));
  return jsonb_build_object('episode_id',p_episode_id,'status','restored');
end $$;

create or replace function public.creator_delete_material(p_material_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_item public.story_material_sections%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select m.* into v_item from public.story_material_sections m
  join public.story_creators sc on sc.story_id=m.story_id
  where m.id=p_material_id and sc.creator_id=v_user and sc.role in ('owner','author','editor')
  for update of m;
  if not found then raise exception 'Manuscript section not found or access denied'; end if;
  if v_item.deleted_at is not null then return jsonb_build_object('material_id',p_material_id,'status','already_deleted'); end if;
  update public.story_material_sections set deleted_at=now(),deleted_by=v_user,deleted_from_status=publication_status,publication_status='draft',is_visible=false,updated_at=now() where id=p_material_id;
  insert into public.creator_content_audit(entity_type,entity_id,entity_title,actor_id,action,details)
  values('material',p_material_id,v_item.title,v_user,'deleted',jsonb_build_object('story_id',v_item.story_id,'previous_status',v_item.publication_status));
  return jsonb_build_object('material_id',p_material_id,'status','deleted');
end $$;

create or replace function public.creator_restore_material(p_material_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_item public.story_material_sections%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select m.* into v_item from public.story_material_sections m
  join public.story_creators sc on sc.story_id=m.story_id
  where m.id=p_material_id and m.deleted_at is not null and sc.creator_id=v_user and sc.role in ('owner','author','editor')
  for update of m;
  if not found then raise exception 'Trashed manuscript section not found or access denied'; end if;
  update public.story_material_sections set deleted_at=null,deleted_by=null,deleted_from_status=null,publication_status='draft',is_visible=true,updated_at=now() where id=p_material_id;
  insert into public.creator_content_audit(entity_type,entity_id,entity_title,actor_id,action)
  values('material',p_material_id,v_item.title,v_user,'restored');
  return jsonb_build_object('material_id',p_material_id,'status','restored','publication_status','draft');
end $$;

create or replace function public.creator_delete_draft_revision(p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_revision public.episode_revisions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select er.* into v_revision from public.episode_revisions er
  join public.episodes e on e.id=er.episode_id
  join public.story_creators sc on sc.story_id=e.story_id
  where er.id=p_revision_id and sc.creator_id=v_user and sc.role in ('owner','author','editor')
  for update of er;
  if not found then raise exception 'Revision not found or access denied'; end if;
  if v_revision.revision_status <> 'draft' then raise exception 'A published revision cannot be deleted by itself. Delete the chapter to move it to Trash.'; end if;
  if exists(select 1 from public.episode_publication_queue where revision_id=p_revision_id) then raise exception 'This draft is scheduled for publication. Cancel its schedule before deleting it.'; end if;
  insert into public.creator_content_audit(entity_type,entity_id,entity_title,actor_id,action,details)
  select 'revision',p_revision_id,v_revision.title,v_user,'draft_revision_deleted',jsonb_build_object('episode_id',v_revision.episode_id,'revision_number',v_revision.revision_number);
  delete from public.episode_revisions where id=p_revision_id;
  return jsonb_build_object('revision_id',p_revision_id,'status','deleted');
end $$;

create or replace function public.creator_purge_trash(p_entity_type text,p_entity_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_title text; v_story_id uuid; v_episode_ids uuid[];
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_entity_type not in ('story','episode','material') then raise exception 'Unsupported Trash item type'; end if;

  if p_entity_type='story' then
    select s.title into v_title from public.stories s
    join public.story_creators sc on sc.story_id=s.id
    where s.id=p_entity_id and s.deleted_at is not null and sc.creator_id=v_user and sc.role in ('owner','author','editor');
    if v_title is null then raise exception 'Trashed story not found or access denied'; end if;
    select array_agg(id) into v_episode_ids from public.episodes where story_id=p_entity_id;
    if exists(select 1 from public.reader_support_contributions where story_id=p_entity_id)
      or exists(select 1 from public.reading_progress where episode_id=any(coalesce(v_episode_ids,'{}'::uuid[])))
      or exists(select 1 from public.reviews where episode_id=any(coalesce(v_episode_ids,'{}'::uuid[])))
      or exists(select 1 from public.reader_reactions where episode_id=any(coalesce(v_episode_ids,'{}'::uuid[])))
      or exists(select 1 from public.episode_participations where episode_id=any(coalesce(v_episode_ids,'{}'::uuid[])))
      or exists(select 1 from public.episode_entitlements where episode_id=any(coalesce(v_episode_ids,'{}'::uuid[])) or source_episode_id=any(coalesce(v_episode_ids,'{}'::uuid[])))
      or exists(select 1 from public.episode_unlock_events where source_episode_id=any(coalesce(v_episode_ids,'{}'::uuid[])) or unlocked_episode_id=any(coalesce(v_episode_ids,'{}'::uuid[]))) then
      raise exception 'This story has reader activity or support records. It can stay in Trash, but permanent deletion is blocked to preserve those records.';
    end if;
    delete from public.publication_history where story_id=p_entity_id;
    delete from public.stories where id=p_entity_id;
  elsif p_entity_type='episode' then
    select e.title,e.story_id into v_title,v_story_id from public.episodes e
    join public.story_creators sc on sc.story_id=e.story_id
    where e.id=p_entity_id and e.deleted_at is not null and sc.creator_id=v_user and sc.role in ('owner','author','editor');
    if v_title is null then raise exception 'Trashed chapter not found or access denied'; end if;
    if exists(select 1 from public.reading_progress where episode_id=p_entity_id)
      or exists(select 1 from public.reviews where episode_id=p_entity_id)
      or exists(select 1 from public.reader_reactions where episode_id=p_entity_id)
      or exists(select 1 from public.episode_participations where episode_id=p_entity_id)
      or exists(select 1 from public.episode_entitlements where episode_id=p_entity_id or source_episode_id=p_entity_id)
      or exists(select 1 from public.episode_unlock_events where source_episode_id=p_entity_id or unlocked_episode_id=p_entity_id) then
      raise exception 'This chapter has reader activity or access records. It can stay in Trash, but permanent deletion is blocked to preserve those records.';
    end if;
    delete from public.episodes where id=p_entity_id;
  else
    select m.title into v_title from public.story_material_sections m
    join public.story_creators sc on sc.story_id=m.story_id
    where m.id=p_entity_id and m.deleted_at is not null and sc.creator_id=v_user and sc.role in ('owner','author','editor');
    if v_title is null then raise exception 'Trashed manuscript section not found or access denied'; end if;
    delete from public.story_material_sections where id=p_entity_id;
  end if;

  insert into public.creator_content_audit(entity_type,entity_id,entity_title,actor_id,action)
  values(p_entity_type,p_entity_id,v_title,v_user,'purged');
  return jsonb_build_object('entity_type',p_entity_type,'entity_id',p_entity_id,'status','purged');
end $$;

revoke all on function public.creator_delete_story(uuid) from public,anon;
revoke all on function public.creator_restore_story(uuid) from public,anon;
revoke all on function public.creator_delete_episode(uuid) from public,anon;
revoke all on function public.creator_restore_episode(uuid) from public,anon;
revoke all on function public.creator_delete_material(uuid) from public,anon;
revoke all on function public.creator_restore_material(uuid) from public,anon;
revoke all on function public.creator_delete_draft_revision(uuid) from public,anon;
revoke all on function public.creator_purge_trash(text,uuid) from public,anon;
grant execute on function public.creator_delete_story(uuid) to authenticated,service_role;
grant execute on function public.creator_restore_story(uuid) to authenticated,service_role;
grant execute on function public.creator_delete_episode(uuid) to authenticated,service_role;
grant execute on function public.creator_restore_episode(uuid) to authenticated,service_role;
grant execute on function public.creator_delete_material(uuid) to authenticated,service_role;
grant execute on function public.creator_restore_material(uuid) to authenticated,service_role;
grant execute on function public.creator_delete_draft_revision(uuid) to authenticated,service_role;
grant execute on function public.creator_purge_trash(text,uuid) to authenticated,service_role;


-- Creator workspace omits trashed content and refuses to open a trashed story.
create or replace function public.get_creator_story_workspace(p_story_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_user_id uuid := auth.uid();
  v_story jsonb;
  v_role text;
  v_seasons jsonb;
  v_episodes jsonb;
  v_total_episodes integer;
  v_published_episodes integer;
  v_draft_episodes integer;
  v_scheduled_episodes integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.creator_profiles cp where cp.id=v_user_id and cp.status='active') then
    raise exception 'An active creator profile is required';
  end if;
  select sc.role into v_role from public.story_creators sc
  where sc.story_id=p_story_id and sc.creator_id=v_user_id;
  if v_role is null or v_role not in ('owner','author','editor') then
    raise exception 'You do not have permission to manage this story';
  end if;
  select to_jsonb(s) into v_story from public.stories s
  where s.id=p_story_id and s.deleted_at is null;
  if v_story is null then raise exception 'Story not found or moved to Trash'; end if;
  select coalesce(jsonb_agg(to_jsonb(season) order by season.id),'[]'::jsonb)
  into v_seasons from public.seasons season where season.story_id=p_story_id;
  select
    coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
      'latest_revision',(
        select jsonb_build_object('id',er.id,'revision_number',er.revision_number,
          'revision_status',er.revision_status,'created_at',er.created_at,'published_at',er.published_at)
        from public.episode_revisions er where er.episode_id=e.id
        order by er.revision_number desc limit 1
      )
    ) order by e.sequence_number),'[]'::jsonb),
    count(*)::integer,
    count(*) filter(where e.publication_status='published')::integer,
    count(*) filter(where e.publication_status='draft')::integer,
    count(*) filter(where e.publication_status='scheduled')::integer
  into v_episodes,v_total_episodes,v_published_episodes,v_draft_episodes,v_scheduled_episodes
  from public.episodes e where e.story_id=p_story_id and e.deleted_at is null;
  return jsonb_build_object(
    'story',v_story,'creator_role',v_role,'seasons',v_seasons,'episodes',v_episodes,
    'episode_summary',jsonb_build_object('total',v_total_episodes,'published',v_published_episodes,
      'draft',v_draft_episodes,'scheduled',v_scheduled_episodes)
  );
end;
$function$;
