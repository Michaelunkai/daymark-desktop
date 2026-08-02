-- Daymark's durable cloud model. All application rows are workspace-scoped,
-- revisioned, attributed to an actor when one is available, and soft-deletable.

create extension if not exists pgcrypto;

do $$
begin
  create type public.workspace_role as enum ('owner', 'editor', 'viewer');
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  timezone text not null default 'UTC',
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  is_personal boolean not null default false,
  owner_id uuid not null references auth.users (id) on delete restrict,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create unique index if not exists workspaces_one_personal_per_owner_idx
  on public.workspaces (owner_id) where is_personal and deleted_at is null;
create index if not exists workspaces_owner_id_idx on public.workspaces (owner_id);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null,
  accepted_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx
  on public.workspace_members (user_id, workspace_id) where deleted_at is null;

create table if not exists public.workspace_preferences (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  active_project_id uuid,
  show_completed boolean not null default false,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id uuid references public.projects (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '',
  color text not null default 'charcoal',
  layout text not null default 'list' check (layout in ('list', 'board')),
  position numeric(20, 10) not null default 0,
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create index if not exists projects_workspace_position_idx
  on public.projects (workspace_id, position, id) where deleted_at is null;
create index if not exists projects_parent_id_idx on public.projects (parent_id) where deleted_at is null;

alter table public.workspace_preferences
  drop constraint if exists workspace_preferences_active_project_id_fkey;
alter table public.workspace_preferences
  add constraint workspace_preferences_active_project_id_fkey
  foreign key (active_project_id) references public.projects (id) on delete set null;
create index if not exists workspace_preferences_user_id_idx
  on public.workspace_preferences (user_id, workspace_id) where deleted_at is null;
create index if not exists workspace_preferences_active_project_id_idx
  on public.workspace_preferences (active_project_id) where active_project_id is not null;

create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  position numeric(20, 10) not null default 0,
  is_collapsed boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create index if not exists sections_workspace_project_position_idx
  on public.sections (workspace_id, project_id, position, id) where deleted_at is null;
create index if not exists sections_project_id_idx on public.sections (project_id) where deleted_at is null;

create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  color text not null default 'charcoal',
  position numeric(20, 10) not null default 0,
  is_favorite boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  unique (workspace_id, name)
);

create index if not exists labels_workspace_position_idx
  on public.labels (workspace_id, position, id) where deleted_at is null;

create table if not exists public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  color text not null default 'charcoal',
  query text not null check (char_length(btrim(query)) > 0),
  position numeric(20, 10) not null default 0,
  is_favorite boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create index if not exists saved_filters_workspace_user_position_idx
  on public.saved_filters (workspace_id, user_id, position, id) where deleted_at is null;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete restrict,
  section_id uuid references public.sections (id) on delete set null,
  parent_id uuid references public.tasks (id) on delete set null,
  content text not null check (char_length(btrim(content)) between 1 and 1000),
  description text not null default '',
  priority smallint not null default 4 check (priority between 1 and 4),
  due jsonb check (
    due is null
    or (
      jsonb_typeof(due) = 'object'
      and due ? 'date'
      and jsonb_typeof(due -> 'date') = 'string'
    )
  ),
  completed_at timestamptz,
  position numeric(20, 10) not null default 0,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create index if not exists tasks_workspace_open_due_idx
  on public.tasks (workspace_id, (due ->> 'date'), position, id)
  where deleted_at is null and completed_at is null;
create index if not exists tasks_workspace_project_position_idx
  on public.tasks (workspace_id, project_id, section_id, position, id) where deleted_at is null;
create index if not exists tasks_parent_id_idx on public.tasks (parent_id) where deleted_at is null;
create index if not exists tasks_due_gin_idx on public.tasks using gin (due) where deleted_at is null;

create table if not exists public.task_labels (
  task_id uuid not null references public.tasks (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  primary key (task_id, label_id)
);

create index if not exists task_labels_workspace_label_idx
  on public.task_labels (workspace_id, label_id, task_id) where deleted_at is null;

create table if not exists public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  remind_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'sent', 'dismissed', 'failed')),
  delivery_key text not null unique,
  delivered_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create index if not exists task_reminders_delivery_idx
  on public.task_reminders (state, remind_at) where deleted_at is null and state in ('pending', 'failed');
create index if not exists task_reminders_workspace_task_idx
  on public.task_reminders (workspace_id, task_id) where deleted_at is null;

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  author_id uuid not null references auth.users (id) on delete restrict,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create index if not exists task_comments_workspace_task_created_idx
  on public.task_comments (workspace_id, task_id, created_at, id) where deleted_at is null;
create index if not exists task_comments_author_id_idx
  on public.task_comments (author_id) where deleted_at is null;

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('created', 'updated', 'completed', 'reopened', 'comment', 'reminder', 'member', 'invitation')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create index if not exists activity_events_workspace_created_idx
  on public.activity_events (workspace_id, created_at desc, id) where deleted_at is null;
create index if not exists activity_events_task_created_idx
  on public.activity_events (task_id, created_at desc, id) where deleted_at is null;
create index if not exists activity_events_actor_id_idx
  on public.activity_events (actor_id) where deleted_at is null;

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email)),
  role public.workspace_role not null check (role in ('editor', 'viewer')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users (id) on delete restrict,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create unique index if not exists invitations_one_pending_per_email_idx
  on public.invitations (workspace_id, email) where status = 'pending' and deleted_at is null;
create index if not exists invitations_workspace_status_idx
  on public.invitations (workspace_id, status, expires_at) where deleted_at is null;
create index if not exists invitations_invited_by_idx
  on public.invitations (invited_by) where deleted_at is null;
create index if not exists invitations_accepted_by_idx
  on public.invitations (accepted_by) where accepted_by is not null and deleted_at is null;

create table if not exists public.mutation_receipts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  idempotency_key uuid not null,
  actor_id uuid not null references auth.users (id) on delete cascade,
  operation text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

create index if not exists mutation_receipts_created_at_idx
  on public.mutation_receipts (created_at);

create or replace function public.set_audit_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    if old.deleted_at is null and new.deleted_at is not null then
      new.deleted_by := coalesce(auth.uid(), new.deleted_by);
    end if;
  else
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  end if;
  return new;
end;
$$;

create or replace function public.enforce_workspace_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_workspace uuid;
begin
  if tg_table_name = 'projects' and new.parent_id is not null then
    select workspace_id into expected_workspace from public.projects where id = new.parent_id;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'A project parent must be in the same workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'workspace_preferences' and new.active_project_id is not null then
    select workspace_id into expected_workspace
    from public.projects
    where id = new.active_project_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'Workspace preferences must reference a project in the same workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'sections' then
    select workspace_id into expected_workspace from public.projects where id = new.project_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'A section must belong to a live project in the same workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'tasks' then
    select workspace_id into expected_workspace from public.projects where id = new.project_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'A task project must be in the same workspace' using errcode = '23514';
    end if;
    if new.section_id is not null then
      select workspace_id into expected_workspace
      from public.sections
      where id = new.section_id and project_id = new.project_id and deleted_at is null;
      if expected_workspace is distinct from new.workspace_id then
        raise exception 'A task section must belong to its project in the same workspace' using errcode = '23514';
      end if;
    end if;
    if new.parent_id is not null then
      select workspace_id into expected_workspace from public.tasks where id = new.parent_id and deleted_at is null;
      if expected_workspace is distinct from new.workspace_id then
        raise exception 'A task parent must be in the same workspace' using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'task_labels' then
    select workspace_id into expected_workspace from public.tasks where id = new.task_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'A task label must use its task workspace' using errcode = '23514';
    end if;
    select workspace_id into expected_workspace from public.labels where id = new.label_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'A task label must use its label workspace' using errcode = '23514';
    end if;
  elsif tg_table_name in ('task_reminders', 'task_comments') then
    select workspace_id into expected_workspace from public.tasks where id = new.task_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'Task child rows must use the task workspace' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_kind text;
begin
  if tg_op = 'INSERT' then
    event_kind := 'created';
  elsif old.deleted_at is null and new.deleted_at is not null then
    event_kind := 'updated';
  elsif old.completed_at is null and new.completed_at is not null then
    event_kind := 'completed';
  elsif old.completed_at is not null and new.completed_at is null then
    event_kind := 'reopened';
  else
    event_kind := 'updated';
  end if;

  insert into public.activity_events (workspace_id, task_id, project_id, actor_id, kind, payload)
  values (
    new.workspace_id,
    new.id,
    new.project_id,
    coalesce(auth.uid(), new.updated_by, new.created_by),
    event_kind,
    jsonb_build_object('revision', new.revision, 'content', new.content)
  );
  return new;
end;
$$;

create or replace function public.workspace_role_for(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = (select auth.uid())
    and wm.deleted_at is null
  limit 1
$$;

create or replace function public.workspace_owner_for(p_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.owner_id
  from public.workspaces w
  where w.id = p_workspace_id
    and w.deleted_at is null
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role_for(p_workspace_id) is not null
$$;

create or replace function public.can_edit_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role_for(p_workspace_id) in ('owner', 'editor')
$$;

create or replace function public.can_manage_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role_for(p_workspace_id) = 'owner'
$$;

create or replace function public.create_personal_workspace()
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace public.workspaces;
  v_base_slug text;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select * into v_workspace
  from public.workspaces
  where owner_id = v_user_id and is_personal and deleted_at is null
  limit 1;
  if found then
    return v_workspace;
  end if;

  v_base_slug := 'personal-' || replace(v_user_id::text, '-', '');
  insert into public.workspaces (name, slug, is_personal, owner_id, created_by, updated_by)
  values ('Personal', v_base_slug, true, v_user_id, v_user_id, v_user_id)
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, created_by, updated_by)
  values (v_workspace.id, v_user_id, 'owner', v_user_id, v_user_id);

  insert into public.workspace_preferences (workspace_id, user_id, created_by, updated_by)
  values (v_workspace.id, v_user_id, v_user_id, v_user_id);

  return v_workspace;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace public.workspaces;
begin
  insert into public.profiles (id, display_name, avatar_url, timezone, created_by, updated_by)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC'),
    new.id,
    new.id
  )
  on conflict (id) do nothing;

  perform set_config('request.jwt.claim.sub', new.id::text, true);
  v_workspace := public.create_personal_workspace();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_daymark on auth.users;
create trigger on_auth_user_created_daymark
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.apply_task_mutation(
  p_workspace_id uuid,
  p_idempotency_key uuid,
  p_operation text,
  p_task_id uuid default null,
  p_expected_revision bigint default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_receipt public.mutation_receipts;
  v_task public.tasks;
  v_response jsonb;
begin
  if v_actor is null or not public.can_edit_workspace(p_workspace_id) then
    raise exception 'Editor access is required' using errcode = '42501';
  end if;
  if p_operation not in ('create', 'update', 'delete') then
    raise exception 'Unsupported task mutation operation' using errcode = '22023';
  end if;

  insert into public.mutation_receipts (workspace_id, idempotency_key, actor_id, operation, response)
  values (p_workspace_id, p_idempotency_key, v_actor, p_operation, jsonb_build_object('status', 'pending'))
  on conflict (workspace_id, idempotency_key) do nothing;

  select * into v_receipt
  from public.mutation_receipts
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key
  for update;

  if v_receipt.actor_id <> v_actor or v_receipt.operation <> p_operation then
    raise exception 'Idempotency key was already used for another mutation' using errcode = '23505';
  end if;
  if v_receipt.response ->> 'status' <> 'pending' then
    return v_receipt.response;
  end if;

  if p_operation = 'create' then
    if p_task_id is null then
      raise exception 'Task id is required for create' using errcode = '22023';
    end if;
    insert into public.tasks (
      id, workspace_id, project_id, section_id, parent_id, content, description,
      priority, due, completed_at, position, created_by, updated_by
    )
    values (
      p_task_id, p_workspace_id, (p_payload ->> 'project_id')::uuid,
      nullif(p_payload ->> 'section_id', '')::uuid,
      nullif(p_payload ->> 'parent_id', '')::uuid,
      coalesce(p_payload ->> 'content', ''),
      coalesce(p_payload ->> 'description', ''),
      coalesce((p_payload ->> 'priority')::smallint, 4),
      case when p_payload ? 'due' and p_payload -> 'due' <> 'null'::jsonb then p_payload -> 'due' else null end,
      nullif(p_payload ->> 'completed_at', '')::timestamptz,
      coalesce((p_payload ->> 'position')::numeric, 0),
      v_actor, v_actor
    )
    returning * into v_task;
  else
    select * into v_task
    from public.tasks
    where id = p_task_id and workspace_id = p_workspace_id and deleted_at is null
    for update;
    if not found then
      raise exception 'Task not found' using errcode = 'P0002';
    end if;
    if p_expected_revision is null or v_task.revision <> p_expected_revision then
      raise exception 'Task revision conflict' using errcode = '40001';
    end if;

    if p_operation = 'delete' then
      update public.tasks
      set deleted_at = now(), deleted_by = v_actor
      where id = v_task.id
      returning * into v_task;
    else
      update public.tasks
      set
        project_id = case when p_payload ? 'project_id' then (p_payload ->> 'project_id')::uuid else project_id end,
        section_id = case when p_payload ? 'section_id' then nullif(p_payload ->> 'section_id', '')::uuid else section_id end,
        parent_id = case when p_payload ? 'parent_id' then nullif(p_payload ->> 'parent_id', '')::uuid else parent_id end,
        content = case when p_payload ? 'content' then p_payload ->> 'content' else content end,
        description = case when p_payload ? 'description' then coalesce(p_payload ->> 'description', '') else description end,
        priority = case when p_payload ? 'priority' then (p_payload ->> 'priority')::smallint else priority end,
        due = case
          when p_payload ? 'due' and p_payload -> 'due' <> 'null'::jsonb then p_payload -> 'due'
          when p_payload ? 'due' then null
          else due
        end,
        completed_at = case when p_payload ? 'completed_at' then nullif(p_payload ->> 'completed_at', '')::timestamptz else completed_at end,
        position = case when p_payload ? 'position' then (p_payload ->> 'position')::numeric else position end,
        updated_by = v_actor
      where id = v_task.id
      returning * into v_task;
    end if;
  end if;

  v_response := jsonb_build_object(
    'status', 'applied',
    'task', jsonb_build_object(
      'id', v_task.id,
      'workspace_id', v_task.workspace_id,
      'revision', v_task.revision,
      'updated_at', v_task.updated_at,
      'deleted_at', v_task.deleted_at
    )
  );
  update public.mutation_receipts
  set response = v_response
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create or replace function public.transfer_workspace_ownership(
  p_workspace_id uuid,
  p_new_owner_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_receipt public.mutation_receipts;
  v_response jsonb;
begin
  if v_actor is null or not public.can_manage_workspace(p_workspace_id) then
    raise exception 'Owner access is required' using errcode = '42501';
  end if;
  if p_new_owner_id = v_actor then
    raise exception 'The selected member already owns this workspace' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_new_owner_id
      and wm.deleted_at is null
  ) then
    raise exception 'The new owner must be an active workspace member' using errcode = '23503';
  end if;

  insert into public.mutation_receipts (workspace_id, idempotency_key, actor_id, operation, response)
  values (p_workspace_id, p_idempotency_key, v_actor, 'transfer_owner', jsonb_build_object('status', 'pending'))
  on conflict (workspace_id, idempotency_key) do nothing;

  select * into v_receipt
  from public.mutation_receipts
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key
  for update;

  if v_receipt.actor_id <> v_actor or v_receipt.operation <> 'transfer_owner' then
    raise exception 'Idempotency key was already used for another mutation' using errcode = '23505';
  end if;
  if v_receipt.response ->> 'status' <> 'pending' then
    return v_receipt.response;
  end if;

  update public.workspace_members
  set role = case when user_id = p_new_owner_id then 'owner'::public.workspace_role else 'editor'::public.workspace_role end,
      updated_by = v_actor
  where workspace_id = p_workspace_id
    and user_id in (v_actor, p_new_owner_id)
    and deleted_at is null;

  update public.workspaces
  set owner_id = p_new_owner_id, updated_by = v_actor
  where id = p_workspace_id;

  v_response := jsonb_build_object(
    'status', 'applied',
    'workspace_id', p_workspace_id,
    'owner_id', p_new_owner_id
  );
  update public.mutation_receipts
  set response = v_response
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

drop trigger if exists projects_audit_columns on public.projects;
create trigger projects_audit_columns before insert or update on public.projects
for each row execute procedure public.set_audit_columns();
drop trigger if exists sections_audit_columns on public.sections;
create trigger sections_audit_columns before insert or update on public.sections
for each row execute procedure public.set_audit_columns();
drop trigger if exists labels_audit_columns on public.labels;
create trigger labels_audit_columns before insert or update on public.labels
for each row execute procedure public.set_audit_columns();
drop trigger if exists saved_filters_audit_columns on public.saved_filters;
create trigger saved_filters_audit_columns before insert or update on public.saved_filters
for each row execute procedure public.set_audit_columns();
drop trigger if exists tasks_audit_columns on public.tasks;
create trigger tasks_audit_columns before insert or update on public.tasks
for each row execute procedure public.set_audit_columns();
drop trigger if exists task_reminders_audit_columns on public.task_reminders;
create trigger task_reminders_audit_columns before insert or update on public.task_reminders
for each row execute procedure public.set_audit_columns();
drop trigger if exists task_comments_audit_columns on public.task_comments;
create trigger task_comments_audit_columns before insert or update on public.task_comments
for each row execute procedure public.set_audit_columns();
drop trigger if exists invitations_audit_columns on public.invitations;
create trigger invitations_audit_columns before insert or update on public.invitations
for each row execute procedure public.set_audit_columns();
drop trigger if exists workspace_members_audit_columns on public.workspace_members;
create trigger workspace_members_audit_columns before insert or update on public.workspace_members
for each row execute procedure public.set_audit_columns();
drop trigger if exists workspace_preferences_audit_columns on public.workspace_preferences;
create trigger workspace_preferences_audit_columns before insert or update on public.workspace_preferences
for each row execute procedure public.set_audit_columns();
drop trigger if exists workspaces_audit_columns on public.workspaces;
create trigger workspaces_audit_columns before insert or update on public.workspaces
for each row execute procedure public.set_audit_columns();
drop trigger if exists profiles_audit_columns on public.profiles;
create trigger profiles_audit_columns before insert or update on public.profiles
for each row execute procedure public.set_audit_columns();

drop trigger if exists projects_workspace_integrity on public.projects;
create trigger projects_workspace_integrity before insert or update on public.projects
for each row execute procedure public.enforce_workspace_integrity();
drop trigger if exists workspace_preferences_integrity on public.workspace_preferences;
create trigger workspace_preferences_integrity before insert or update on public.workspace_preferences
for each row execute procedure public.enforce_workspace_integrity();
drop trigger if exists sections_workspace_integrity on public.sections;
create trigger sections_workspace_integrity before insert or update on public.sections
for each row execute procedure public.enforce_workspace_integrity();
drop trigger if exists tasks_workspace_integrity on public.tasks;
create trigger tasks_workspace_integrity before insert or update on public.tasks
for each row execute procedure public.enforce_workspace_integrity();
drop trigger if exists task_labels_workspace_integrity on public.task_labels;
create trigger task_labels_workspace_integrity before insert or update on public.task_labels
for each row execute procedure public.enforce_workspace_integrity();
drop trigger if exists task_reminders_workspace_integrity on public.task_reminders;
create trigger task_reminders_workspace_integrity before insert or update on public.task_reminders
for each row execute procedure public.enforce_workspace_integrity();
drop trigger if exists task_comments_workspace_integrity on public.task_comments;
create trigger task_comments_workspace_integrity before insert or update on public.task_comments
for each row execute procedure public.enforce_workspace_integrity();
drop trigger if exists tasks_activity_log on public.tasks;
create trigger tasks_activity_log after insert or update on public.tasks
for each row execute procedure public.log_task_activity();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_preferences enable row level security;
alter table public.projects enable row level security;
alter table public.sections enable row level security;
alter table public.labels enable row level security;
alter table public.saved_filters enable row level security;
alter table public.tasks enable row level security;
alter table public.task_labels enable row level security;
alter table public.task_reminders enable row level security;
alter table public.task_comments enable row level security;
alter table public.activity_events enable row level security;
alter table public.invitations enable row level security;
alter table public.mutation_receipts enable row level security;

create policy profiles_self on public.profiles
  for all using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy workspaces_member_select on public.workspaces
  for select using ((select public.is_workspace_member(id)));
create policy workspaces_owner_update on public.workspaces
  for update using ((select public.can_manage_workspace(id)))
  with check (
    (select public.can_manage_workspace(id))
    and owner_id = (select public.workspace_owner_for(id))
  );
create policy workspaces_authenticated_insert on public.workspaces
  for insert with check (owner_id = (select auth.uid()) and created_by = (select auth.uid()));

create policy workspace_members_member_select on public.workspace_members
  for select using ((select public.is_workspace_member(workspace_id)));
create policy workspace_members_owner_insert on public.workspace_members
  for insert with check (
    (
      (select public.can_manage_workspace(workspace_id))
      and role <> 'owner'
    )
    or (
      role = 'owner'
      and user_id = (select auth.uid())
      and user_id = (select public.workspace_owner_for(workspace_id))
    )
  );
create policy workspace_members_owner_update on public.workspace_members
  for update using ((select public.can_manage_workspace(workspace_id)))
  with check (
    (select public.can_manage_workspace(workspace_id))
    and (role <> 'owner' or user_id = (select public.workspace_owner_for(workspace_id)))
    and (
      user_id <> (select public.workspace_owner_for(workspace_id))
      or (role = 'owner' and deleted_at is null)
    )
  );
create policy workspace_members_self_soft_delete on public.workspace_members
  for update using (user_id = (select auth.uid()) and role <> 'owner')
  with check (user_id = (select auth.uid()) and role <> 'owner' and deleted_at is not null);

create policy workspace_preferences_self on public.workspace_preferences
  for all using (user_id = (select auth.uid()) and (select public.is_workspace_member(workspace_id)))
  with check (user_id = (select auth.uid()) and (select public.is_workspace_member(workspace_id)));

create policy projects_member_select on public.projects
  for select using ((select public.is_workspace_member(workspace_id)));
create policy projects_editor_write on public.projects
  for all using ((select public.can_edit_workspace(workspace_id))) with check ((select public.can_edit_workspace(workspace_id)));
create policy sections_member_select on public.sections
  for select using ((select public.is_workspace_member(workspace_id)));
create policy sections_editor_write on public.sections
  for all using ((select public.can_edit_workspace(workspace_id))) with check ((select public.can_edit_workspace(workspace_id)));
create policy labels_member_select on public.labels
  for select using ((select public.is_workspace_member(workspace_id)));
create policy labels_editor_write on public.labels
  for all using ((select public.can_edit_workspace(workspace_id))) with check ((select public.can_edit_workspace(workspace_id)));
create policy saved_filters_owner_only on public.saved_filters
  for all using (user_id = (select auth.uid()) and (select public.is_workspace_member(workspace_id)))
  with check (user_id = (select auth.uid()) and (select public.is_workspace_member(workspace_id)));
create policy tasks_member_select on public.tasks
  for select using ((select public.is_workspace_member(workspace_id)));
create policy tasks_editor_write on public.tasks
  for all using ((select public.can_edit_workspace(workspace_id))) with check ((select public.can_edit_workspace(workspace_id)));
create policy task_labels_member_select on public.task_labels
  for select using ((select public.is_workspace_member(workspace_id)));
create policy task_labels_editor_write on public.task_labels
  for all using ((select public.can_edit_workspace(workspace_id))) with check ((select public.can_edit_workspace(workspace_id)));
create policy task_reminders_member_select on public.task_reminders
  for select using ((select public.is_workspace_member(workspace_id)));
create policy task_reminders_editor_write on public.task_reminders
  for all using ((select public.can_edit_workspace(workspace_id))) with check ((select public.can_edit_workspace(workspace_id)));
create policy task_comments_member_select on public.task_comments
  for select using ((select public.is_workspace_member(workspace_id)));
create policy task_comments_editor_insert on public.task_comments
  for insert with check ((select public.can_edit_workspace(workspace_id)) and author_id = (select auth.uid()));
create policy task_comments_author_or_owner_update on public.task_comments
  for update using (author_id = (select auth.uid()) or (select public.can_manage_workspace(workspace_id)))
  with check (author_id = (select auth.uid()) or (select public.can_manage_workspace(workspace_id)));
create policy activity_events_member_select on public.activity_events
  for select using ((select public.is_workspace_member(workspace_id)));
create policy activity_events_editor_insert on public.activity_events
  for insert with check ((select public.can_edit_workspace(workspace_id)) and actor_id = (select auth.uid()));
create policy invitations_owner_only on public.invitations
  for all using ((select public.can_manage_workspace(workspace_id))) with check ((select public.can_manage_workspace(workspace_id)));
create policy mutation_receipts_actor_only on public.mutation_receipts
  for select using (actor_id = (select auth.uid()) and (select public.is_workspace_member(workspace_id)));

revoke all on function public.workspace_role_for(uuid) from public;
revoke all on function public.workspace_owner_for(uuid) from public;
revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.can_edit_workspace(uuid) from public;
revoke all on function public.can_manage_workspace(uuid) from public;
revoke all on function public.create_personal_workspace() from public;
revoke all on function public.apply_task_mutation(uuid, uuid, text, uuid, bigint, jsonb) from public;
revoke all on function public.transfer_workspace_ownership(uuid, uuid, uuid) from public;
revoke all on function public.enforce_workspace_integrity() from public;
revoke all on function public.log_task_activity() from public;
revoke all on function public.handle_new_user() from public;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles, public.workspaces, public.workspace_members,
  public.workspace_preferences, public.projects, public.sections, public.labels, public.saved_filters,
  public.tasks, public.task_labels, public.task_reminders, public.task_comments, public.activity_events,
  public.invitations, public.mutation_receipts to authenticated;
grant execute on function public.create_personal_workspace() to authenticated;
grant execute on function public.apply_task_mutation(uuid, uuid, text, uuid, bigint, jsonb) to authenticated;
grant execute on function public.transfer_workspace_ownership(uuid, uuid, uuid) to authenticated;
grant execute on function public.workspace_role_for(uuid), public.workspace_owner_for(uuid), public.is_workspace_member(uuid),
  public.can_edit_workspace(uuid), public.can_manage_workspace(uuid) to authenticated;
