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
  active_project_id text,
  inbox_project_id text,
  onboarding_dismissed boolean not null default false,
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
  id text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id text,
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
  deleted_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, id)
);

create index if not exists projects_workspace_position_idx
  on public.projects (workspace_id, position, id) where deleted_at is null;
create index if not exists projects_parent_id_idx on public.projects (parent_id) where deleted_at is null;

alter table public.workspace_preferences
  drop constraint if exists workspace_preferences_active_project_id_fkey;
alter table public.workspace_preferences
  add constraint workspace_preferences_active_project_id_fkey
  foreign key (workspace_id, active_project_id) references public.projects (workspace_id, id) on delete restrict;
alter table public.workspace_preferences
  drop constraint if exists workspace_preferences_inbox_project_id_fkey;
alter table public.workspace_preferences
  add constraint workspace_preferences_inbox_project_id_fkey
  foreign key (workspace_id, inbox_project_id) references public.projects (workspace_id, id) on delete restrict;
create index if not exists workspace_preferences_user_id_idx
  on public.workspace_preferences (user_id, workspace_id) where deleted_at is null;
create index if not exists workspace_preferences_active_project_id_idx
  on public.workspace_preferences (active_project_id) where active_project_id is not null;

create table if not exists public.sections (
  id text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id text not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  position numeric(20, 10) not null default 0,
  is_collapsed boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade
);

create index if not exists sections_workspace_project_position_idx
  on public.sections (workspace_id, project_id, position, id) where deleted_at is null;
create index if not exists sections_project_id_idx on public.sections (project_id) where deleted_at is null;

create table if not exists public.labels (
  id text not null,
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
  primary key (workspace_id, id),
  unique (workspace_id, name)
);

create index if not exists labels_workspace_position_idx
  on public.labels (workspace_id, position, id) where deleted_at is null;

create table if not exists public.saved_filters (
  id text not null,
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
  deleted_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, id)
);

create index if not exists saved_filters_workspace_user_position_idx
  on public.saved_filters (workspace_id, user_id, position, id) where deleted_at is null;

create table if not exists public.tasks (
  id text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id text not null,
  section_id text,
  parent_id text,
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
  deleted_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete restrict
);

create index if not exists tasks_workspace_open_due_idx
  on public.tasks (workspace_id, (due ->> 'date'), position, id)
  where deleted_at is null and completed_at is null;
create index if not exists tasks_workspace_project_position_idx
  on public.tasks (workspace_id, project_id, section_id, position, id) where deleted_at is null;
create index if not exists tasks_parent_id_idx on public.tasks (parent_id) where deleted_at is null;
create index if not exists tasks_due_gin_idx on public.tasks using gin (due) where deleted_at is null;

create table if not exists public.task_labels (
  task_id text not null,
  label_id text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, task_id, label_id),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id) on delete cascade,
  foreign key (workspace_id, label_id) references public.labels (workspace_id, id) on delete cascade
);

create index if not exists task_labels_workspace_label_idx
  on public.task_labels (workspace_id, label_id, task_id) where deleted_at is null;

create table if not exists public.task_reminders (
  id text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id text not null,
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
  deleted_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, id),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id) on delete cascade
);

create index if not exists task_reminders_delivery_idx
  on public.task_reminders (state, remind_at) where deleted_at is null and state in ('pending', 'failed');
create index if not exists task_reminders_workspace_task_idx
  on public.task_reminders (workspace_id, task_id) where deleted_at is null;

create table if not exists public.task_comments (
  id text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id text not null,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  author_id uuid not null references auth.users (id) on delete restrict,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, id),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id) on delete cascade
);

create index if not exists task_comments_workspace_task_created_idx
  on public.task_comments (workspace_id, task_id, created_at, id) where deleted_at is null;
create index if not exists task_comments_author_id_idx
  on public.task_comments (author_id) where deleted_at is null;

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id text,
  project_id text,
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
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  actor_id uuid not null references auth.users (id) on delete cascade,
  operation text not null,
  client_id text,
  request_fingerprint text,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

create index if not exists mutation_receipts_created_at_idx
  on public.mutation_receipts (created_at);

create table if not exists public.workspace_changes (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id text not null check (char_length(btrim(id)) between 1 and 200),
  client_id text not null check (char_length(btrim(client_id)) between 1 and 200),
  revision bigint not null check (revision > 0),
  mutation jsonb not null check (jsonb_typeof(mutation) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, id)
);

create index if not exists workspace_changes_workspace_revision_idx
  on public.workspace_changes (workspace_id, revision, created_at, id);
create index if not exists workspace_changes_workspace_client_idx
  on public.workspace_changes (workspace_id, client_id, created_at desc);

create table if not exists public.api_rate_limits (
  actor_id uuid not null references auth.users (id) on delete cascade,
  rate_key text not null check (char_length(btrim(rate_key)) between 1 and 200),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (actor_id, rate_key)
);

create index if not exists api_rate_limits_updated_at_idx
  on public.api_rate_limits (updated_at);

create table if not exists public.reminder_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users (id) on delete cascade,
  recipient_user_id uuid references auth.users (id) on delete set null,
  recipient_email text not null check (
    recipient_email = lower(btrim(recipient_email))
    and char_length(recipient_email) between 3 and 320
    and position('@' in recipient_email) > 1
  ),
  reminder jsonb not null check (
    jsonb_typeof(reminder) = 'object'
    and reminder ? 'id'
    and reminder ? 'taskId'
    and reminder ? 'taskTitle'
  ),
  scheduled_for timestamptz not null,
  timezone text not null check (char_length(btrim(timezone)) between 1 and 100),
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  provider_message_id text,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days',
  unique (requested_by, idempotency_key)
);

create index if not exists reminder_delivery_queue_due_idx
  on public.reminder_delivery_queue (status, scheduled_for, next_attempt_at, id)
  where status in ('queued', 'failed');
create index if not exists reminder_delivery_queue_requested_by_idx
  on public.reminder_delivery_queue (requested_by, created_at desc);
create index if not exists reminder_delivery_queue_recipient_user_idx
  on public.reminder_delivery_queue (recipient_user_id, created_at desc)
  where recipient_user_id is not null;
create index if not exists reminder_delivery_queue_expires_idx
  on public.reminder_delivery_queue (expires_at)
  where status in ('sent', 'cancelled', 'failed');

create table if not exists public.export_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'expired')),
  artifact_path text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days'
);

create unique index if not exists export_requests_one_active_per_user_idx
  on public.export_requests (workspace_id, requested_by)
  where status in ('pending', 'processing');
create index if not exists export_requests_workspace_status_idx
  on public.export_requests (workspace_id, status, created_at desc);
create index if not exists export_requests_expires_idx
  on public.export_requests (expires_at)
  where status in ('completed', 'failed', 'expired');

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  requested_user_id uuid not null,
  request_idempotency_key text not null check (char_length(btrim(request_idempotency_key)) between 1 and 200),
  confirm_idempotency_key text check (confirm_idempotency_key is null or char_length(btrim(confirm_idempotency_key)) between 1 and 200),
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'cancelled')),
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  check (user_id is null or user_id = requested_user_id)
);

create index if not exists account_deletion_requests_status_expiry_idx
  on public.account_deletion_requests (status, expires_at);
create index if not exists account_deletion_requests_requested_user_idx
  on public.account_deletion_requests (requested_user_id, created_at desc);

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
    select workspace_id into expected_workspace from public.projects where workspace_id = new.workspace_id and id = new.parent_id;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'A project parent must be in the same workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'workspace_preferences' and new.active_project_id is not null then
    select workspace_id into expected_workspace
    from public.projects
    where workspace_id = new.workspace_id and id = new.active_project_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'Workspace preferences must reference a project in the same workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'sections' then
    select workspace_id into expected_workspace from public.projects where workspace_id = new.workspace_id and id = new.project_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'A section must belong to a live project in the same workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'tasks' then
    select workspace_id into expected_workspace from public.projects where workspace_id = new.workspace_id and id = new.project_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'A task project must be in the same workspace' using errcode = '23514';
    end if;
    if new.section_id is not null then
      select workspace_id into expected_workspace
      from public.sections
      where workspace_id = new.workspace_id and id = new.section_id and project_id = new.project_id and deleted_at is null;
      if expected_workspace is distinct from new.workspace_id then
        raise exception 'A task section must belong to its project in the same workspace' using errcode = '23514';
      end if;
    end if;
    if new.parent_id is not null then
      select workspace_id into expected_workspace from public.tasks where workspace_id = new.workspace_id and id = new.parent_id and deleted_at is null;
      if expected_workspace is distinct from new.workspace_id then
        raise exception 'A task parent must be in the same workspace' using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'task_labels' then
    select workspace_id into expected_workspace from public.tasks where workspace_id = new.workspace_id and id = new.task_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'A task label must use its task workspace' using errcode = '23514';
    end if;
    select workspace_id into expected_workspace from public.labels where workspace_id = new.workspace_id and id = new.label_id and deleted_at is null;
    if expected_workspace is distinct from new.workspace_id then
      raise exception 'A task label must use its label workspace' using errcode = '23514';
    end if;
  elsif tg_table_name in ('task_reminders', 'task_comments') then
    select workspace_id into expected_workspace from public.tasks where workspace_id = new.workspace_id and id = new.task_id and deleted_at is null;
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
  select coalesce(public.workspace_role_for(p_workspace_id) in ('owner', 'editor'), false)
$$;

create or replace function public.can_manage_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_role_for(p_workspace_id) = 'owner', false)
$$;

create or replace function public.daymark_workspace_state(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace public.workspaces;
  v_preferences public.workspace_preferences;
  v_fallback_project text;
  v_projects jsonb;
  v_sections jsonb;
  v_labels jsonb;
  v_filters jsonb;
  v_tasks jsonb;
begin
  select * into v_workspace
  from public.workspaces
  where id = p_workspace_id and deleted_at is null;
  if not found then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;

  select * into v_preferences
  from public.workspace_preferences
  where workspace_id = p_workspace_id and user_id = auth.uid() and deleted_at is null;

  select id into v_fallback_project
  from public.projects
  where workspace_id = p_workspace_id and deleted_at is null
  order by position, id
  limit 1;
  if v_fallback_project is null then
    raise exception 'Workspace must contain an Inbox project' using errcode = '23514';
  end if;

  select coalesce(jsonb_object_agg(p.id, jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'color', p.color,
    'parentId', p.parent_id, 'layout', p.layout, 'order', p.position,
    'isFavorite', p.is_favorite, 'isArchived', p.is_archived,
    'createdAt', p.created_at, 'updatedAt', p.updated_at
  )), '{}'::jsonb) into v_projects
  from public.projects p
  where p.workspace_id = p_workspace_id and p.deleted_at is null;

  select coalesce(jsonb_object_agg(s.id, jsonb_build_object(
    'id', s.id, 'projectId', s.project_id, 'name', s.name, 'order', s.position,
    'isCollapsed', s.is_collapsed, 'createdAt', s.created_at, 'updatedAt', s.updated_at
  )), '{}'::jsonb) into v_sections
  from public.sections s
  where s.workspace_id = p_workspace_id and s.deleted_at is null;

  select coalesce(jsonb_object_agg(l.id, jsonb_build_object(
    'id', l.id, 'name', l.name, 'color', l.color, 'order', l.position,
    'isFavorite', l.is_favorite, 'createdAt', l.created_at, 'updatedAt', l.updated_at
  )), '{}'::jsonb) into v_labels
  from public.labels l
  where l.workspace_id = p_workspace_id and l.deleted_at is null;

  select coalesce(jsonb_object_agg(f.id, jsonb_build_object(
    'id', f.id, 'name', f.name, 'color', f.color, 'query', f.query, 'order', f.position,
    'isFavorite', f.is_favorite, 'createdAt', f.created_at, 'updatedAt', f.updated_at
  )), '{}'::jsonb) into v_filters
  from public.saved_filters f
  where f.workspace_id = p_workspace_id and f.user_id = auth.uid() and f.deleted_at is null;

  select coalesce(jsonb_object_agg(t.id, jsonb_build_object(
    'id', t.id, 'content', t.content, 'description', t.description,
    'projectId', t.project_id, 'sectionId', t.section_id, 'parentId', t.parent_id,
    'labelIds', coalesce((
      select jsonb_agg(tl.label_id order by tl.label_id)
      from public.task_labels tl
      where tl.workspace_id = t.workspace_id and tl.task_id = t.id and tl.deleted_at is null
    ), '[]'::jsonb),
    'priority', t.priority, 'due', t.due, 'completedAt', t.completed_at,
    'order', t.position, 'createdAt', t.created_at, 'updatedAt', t.updated_at
  )), '{}'::jsonb) into v_tasks
  from public.tasks t
  where t.workspace_id = p_workspace_id and t.deleted_at is null;

  return jsonb_build_object(
    'schemaVersion', 2,
    'revision', v_workspace.revision,
    'clientId', coalesce(auth.uid()::text, ''),
    'updatedAt', v_workspace.updated_at,
    'projects', v_projects,
    'sections', v_sections,
    'labels', v_labels,
    'filters', v_filters,
    'tasks', v_tasks,
    'preferences', jsonb_build_object(
      'inboxProjectId', coalesce(v_preferences.inbox_project_id, v_fallback_project),
      'activeProjectId', coalesce(v_preferences.active_project_id, v_fallback_project),
      'onboardingDismissed', coalesce(v_preferences.onboarding_dismissed, false),
      'theme', coalesce(v_preferences.theme, 'system'),
      'showCompleted', coalesce(v_preferences.show_completed, false)
    ),
    'undoStack', '[]'::jsonb
  );
end;
$$;

create or replace function public.daymark_get_workspace_snapshot(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace membership is required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'revision', (select revision from public.workspaces where id = p_workspace_id and deleted_at is null),
    'state', public.daymark_workspace_state(p_workspace_id)
  );
end;
$$;

create or replace function public.daymark_bootstrap_workspace(p_workspace_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace public.workspaces;
  v_name text := nullif(btrim(coalesce(p_workspace_name, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  v_workspace := public.create_personal_workspace();
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'Workspace name is too long' using errcode = '22001';
  end if;
  if v_name is not null and v_name <> v_workspace.name then
    update public.workspaces
    set name = v_name, updated_by = auth.uid()
    where id = v_workspace.id
    returning * into v_workspace;
  end if;
  return jsonb_build_object(
    'id', v_workspace.id,
    'ownerId', v_workspace.owner_id,
    'name', v_workspace.name,
    'createdAt', v_workspace.created_at
  );
end;
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

  insert into public.projects (
    workspace_id, id, name, description, color, layout, position, is_favorite, created_by, updated_by
  )
  values (
    v_workspace.id, 'project-inbox', 'Inbox', 'A quick place to capture work before organizing it.',
    'charcoal', 'list', 0, true, v_user_id, v_user_id
  );

  insert into public.workspace_preferences (
    workspace_id, user_id, inbox_project_id, active_project_id, created_by, updated_by
  )
  values (v_workspace.id, v_user_id, 'project-inbox', 'project-inbox', v_user_id, v_user_id);

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
  p_idempotency_key text,
  p_operation text,
  p_task_id text default null,
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
      p_task_id, p_workspace_id, p_payload ->> 'project_id',
      nullif(p_payload ->> 'section_id', ''),
      nullif(p_payload ->> 'parent_id', ''),
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
      where workspace_id = p_workspace_id and id = v_task.id
      returning * into v_task;
    else
      update public.tasks
      set
        project_id = case when p_payload ? 'project_id' then p_payload ->> 'project_id' else project_id end,
        section_id = case when p_payload ? 'section_id' then nullif(p_payload ->> 'section_id', '') else section_id end,
        parent_id = case when p_payload ? 'parent_id' then nullif(p_payload ->> 'parent_id', '') else parent_id end,
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
        and workspace_id = p_workspace_id
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
  p_idempotency_key text
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

create or replace function public.daymark_apply_workspace_mutations(
  p_workspace_id uuid,
  p_client_id text,
  p_expected_revision bigint,
  p_mutations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace public.workspaces;
  v_mutation jsonb;
  v_payload jsonb;
  v_input jsonb;
  v_patch jsonb;
  v_mutation_id text;
  v_type text;
  v_entity_id text;
  v_fingerprint text;
  v_existing public.mutation_receipts;
  v_seen text[] := '{}';
  v_all_replayed boolean := true;
  v_revision bigint;
  v_index integer;
begin
  if v_actor is null or not public.can_edit_workspace(p_workspace_id) then
    raise exception 'Editor access is required' using errcode = '42501';
  end if;
  if p_client_id is null or char_length(btrim(p_client_id)) = 0 then
    raise exception 'A client id is required' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
    or p_mutations is null or jsonb_typeof(p_mutations) <> 'array' or jsonb_array_length(p_mutations) = 0 then
    raise exception 'A non-empty mutation array and expected revision are required' using errcode = '22023';
  end if;

  select * into v_workspace
  from public.workspaces
  where id = p_workspace_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;

  for v_mutation in select value from jsonb_array_elements(p_mutations)
  loop
    if jsonb_typeof(v_mutation) <> 'object'
      or jsonb_typeof(v_mutation -> 'payload') <> 'object'
      or jsonb_typeof(v_mutation -> 'id') <> 'string'
      or jsonb_typeof(v_mutation -> 'clientId') <> 'string'
      or jsonb_typeof(v_mutation -> 'type') <> 'string'
      or jsonb_typeof(v_mutation -> 'occurredAt') <> 'string' then
      raise exception 'Malformed Daymark mutation' using errcode = '22023';
    end if;
    v_mutation_id := v_mutation ->> 'id';
    v_type := v_mutation ->> 'type';
    if char_length(btrim(v_mutation_id)) = 0 or char_length(v_mutation_id) > 200
      or v_mutation ->> 'clientId' <> p_client_id
      or v_type not in (
        'task.add', 'task.update', 'task.complete', 'task.uncomplete', 'task.delete',
        'project.add', 'project.update', 'project.archive', 'project.delete',
        'section.add', 'section.update', 'section.delete',
        'label.add', 'label.update', 'filter.add', 'filter.update', 'preferences.update'
      ) then
      raise exception 'Invalid Daymark mutation metadata' using errcode = '22023';
    end if;
    begin
      perform (v_mutation ->> 'occurredAt')::timestamptz;
    exception
      when invalid_datetime_format then
        raise exception 'Mutation occurredAt must be an ISO timestamp' using errcode = '22023';
    end;
    if v_mutation_id = any(v_seen) then
      raise exception 'Mutation ids must be unique within a batch' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_mutation_id);
    v_fingerprint := encode(digest(v_mutation::text, 'sha256'), 'hex');
    select * into v_existing
    from public.mutation_receipts
    where workspace_id = p_workspace_id and idempotency_key = v_mutation_id;
    if found then
      if v_existing.actor_id <> v_actor
        or v_existing.client_id is distinct from p_client_id
        or v_existing.operation <> v_type
        or v_existing.request_fingerprint is distinct from v_fingerprint then
        raise exception 'Idempotency key was reused with a different mutation' using errcode = '23505';
      end if;
    else
      v_all_replayed := false;
    end if;
  end loop;

  if v_all_replayed then
    return public.daymark_get_workspace_snapshot(p_workspace_id);
  end if;
  if exists (
    select 1 from public.mutation_receipts
    where workspace_id = p_workspace_id and idempotency_key = any(v_seen)
  ) then
    raise exception 'A batch cannot mix replayed and new mutations' using errcode = '40001';
  end if;
  if v_workspace.revision <> p_expected_revision then
    raise exception 'Workspace revision conflict' using errcode = '40001';
  end if;

  for v_index in 0 .. jsonb_array_length(p_mutations) - 1
  loop
    v_mutation := p_mutations -> v_index;
    v_payload := v_mutation -> 'payload';
    v_input := coalesce(v_payload -> 'input', v_payload);
    v_patch := coalesce(v_payload -> 'patch', v_payload);
    v_mutation_id := v_mutation ->> 'id';
    v_type := v_mutation ->> 'type';
    v_entity_id := coalesce(v_mutation ->> 'entityId', v_payload ->> 'taskId', v_payload ->> 'projectId', v_payload ->> 'sectionId', v_payload ->> 'labelId', v_payload ->> 'filterId', v_input ->> 'id');

    if v_type = 'task.add' then
      if v_entity_id is null or nullif(btrim(v_input ->> 'content'), '') is null or nullif(v_input ->> 'projectId', '') is null then
        raise exception 'task.add requires id, content, and projectId' using errcode = '22023';
      end if;
      insert into public.tasks (workspace_id, id, project_id, section_id, parent_id, content, description, priority, due, completed_at, position, created_by, updated_by)
      values (p_workspace_id, v_entity_id, v_input ->> 'projectId', nullif(v_input ->> 'sectionId', ''), nullif(v_input ->> 'parentId', ''), v_input ->> 'content', coalesce(v_input ->> 'description', ''), coalesce((v_input ->> 'priority')::smallint, 4), v_input -> 'due', nullif(v_input ->> 'completedAt', '')::timestamptz, coalesce((v_input ->> 'order')::numeric, 0), v_actor, v_actor);
      if jsonb_typeof(v_input -> 'labelIds') = 'array' then
        insert into public.task_labels (workspace_id, task_id, label_id, created_by)
        select p_workspace_id, v_entity_id, value, v_actor from jsonb_array_elements_text(v_input -> 'labelIds');
      end if;
    elsif v_type = 'task.update' then
      if v_entity_id is null then raise exception 'task.update requires entityId' using errcode = '22023'; end if;
      update public.tasks set
        project_id = case when v_patch ? 'projectId' then v_patch ->> 'projectId' else project_id end,
        section_id = case when v_patch ? 'sectionId' then nullif(v_patch ->> 'sectionId', '') else section_id end,
        parent_id = case when v_patch ? 'parentId' then nullif(v_patch ->> 'parentId', '') else parent_id end,
        content = case when v_patch ? 'content' then v_patch ->> 'content' else content end,
        description = case when v_patch ? 'description' then coalesce(v_patch ->> 'description', '') else description end,
        priority = case when v_patch ? 'priority' then (v_patch ->> 'priority')::smallint else priority end,
        due = case when v_patch ? 'due' then v_patch -> 'due' else due end,
        completed_at = case when v_patch ? 'completedAt' then nullif(v_patch ->> 'completedAt', '')::timestamptz else completed_at end,
        position = case when v_patch ? 'order' then (v_patch ->> 'order')::numeric else position end,
        updated_by = v_actor
      where workspace_id = p_workspace_id and id = v_entity_id and deleted_at is null;
      if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
      if v_patch ? 'labelIds' then
        if jsonb_typeof(v_patch -> 'labelIds') <> 'array' then raise exception 'labelIds must be an array' using errcode = '22023'; end if;
        update public.task_labels set deleted_at = now(), deleted_by = v_actor where workspace_id = p_workspace_id and task_id = v_entity_id and deleted_at is null;
        insert into public.task_labels (workspace_id, task_id, label_id, created_by)
        select p_workspace_id, v_entity_id, value, v_actor from jsonb_array_elements_text(v_patch -> 'labelIds');
      end if;
    elsif v_type = 'task.complete' or v_type = 'task.uncomplete' then
      if v_entity_id is null then raise exception 'Task completion requires entityId' using errcode = '22023'; end if;
      update public.tasks set completed_at = case when v_type = 'task.complete' then now() else null end, updated_by = v_actor
      where workspace_id = p_workspace_id and id = v_entity_id and deleted_at is null;
      if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
    elsif v_type = 'task.delete' then
      if v_entity_id is null then raise exception 'task.delete requires entityId' using errcode = '22023'; end if;
      update public.tasks set deleted_at = now(), deleted_by = v_actor
      where workspace_id = p_workspace_id and (id = v_entity_id or parent_id = v_entity_id) and deleted_at is null;
    elsif v_type = 'project.add' then
      if v_entity_id is null or nullif(btrim(v_input ->> 'name'), '') is null then raise exception 'project.add requires id and name' using errcode = '22023'; end if;
      insert into public.projects (workspace_id, id, parent_id, name, description, color, layout, position, is_favorite, created_by, updated_by)
      values (p_workspace_id, v_entity_id, nullif(v_input ->> 'parentId', ''), v_input ->> 'name', coalesce(v_input ->> 'description', ''), coalesce(v_input ->> 'color', 'charcoal'), coalesce(v_input ->> 'layout', 'list'), coalesce((v_input ->> 'order')::numeric, 0), coalesce((v_input ->> 'isFavorite')::boolean, false), v_actor, v_actor);
    elsif v_type = 'project.update' or v_type = 'project.archive' then
      if v_entity_id is null then raise exception 'Project mutation requires entityId' using errcode = '22023'; end if;
      update public.projects set
        parent_id = case when v_patch ? 'parentId' then nullif(v_patch ->> 'parentId', '') else parent_id end,
        name = case when v_patch ? 'name' then v_patch ->> 'name' else name end,
        description = case when v_patch ? 'description' then coalesce(v_patch ->> 'description', '') else description end,
        color = case when v_patch ? 'color' then v_patch ->> 'color' else color end,
        layout = case when v_patch ? 'layout' then v_patch ->> 'layout' else layout end,
        position = case when v_patch ? 'order' then (v_patch ->> 'order')::numeric else position end,
        is_favorite = case when v_patch ? 'isFavorite' then (v_patch ->> 'isFavorite')::boolean else is_favorite end,
        is_archived = case when v_type = 'project.archive' then coalesce((v_payload ->> 'archived')::boolean, true) else is_archived end,
        updated_by = v_actor
      where workspace_id = p_workspace_id and id = v_entity_id and deleted_at is null;
      if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
    elsif v_type = 'project.delete' then
      if v_entity_id is null or exists (select 1 from public.workspace_preferences where workspace_id = p_workspace_id and inbox_project_id = v_entity_id and deleted_at is null) then raise exception 'The Inbox project cannot be deleted' using errcode = '22023'; end if;
      update public.projects set deleted_at = now(), deleted_by = v_actor where workspace_id = p_workspace_id and (id = v_entity_id or parent_id = v_entity_id) and deleted_at is null;
      update public.sections set deleted_at = now(), deleted_by = v_actor where workspace_id = p_workspace_id and project_id = v_entity_id and deleted_at is null;
      update public.tasks set deleted_at = now(), deleted_by = v_actor where workspace_id = p_workspace_id and project_id = v_entity_id and deleted_at is null;
    elsif v_type = 'section.add' then
      if v_entity_id is null or nullif(btrim(v_input ->> 'name'), '') is null or nullif(v_input ->> 'projectId', '') is null then raise exception 'section.add requires id, name, and projectId' using errcode = '22023'; end if;
      insert into public.sections (workspace_id, id, project_id, name, position, is_collapsed, created_by, updated_by)
      values (p_workspace_id, v_entity_id, v_input ->> 'projectId', v_input ->> 'name', coalesce((v_input ->> 'order')::numeric, 0), coalesce((v_input ->> 'isCollapsed')::boolean, false), v_actor, v_actor);
    elsif v_type = 'section.update' then
      if v_entity_id is null then raise exception 'section.update requires entityId' using errcode = '22023'; end if;
      update public.sections set name = case when v_patch ? 'name' then v_patch ->> 'name' else name end, position = case when v_patch ? 'order' then (v_patch ->> 'order')::numeric else position end, is_collapsed = case when v_patch ? 'isCollapsed' then (v_patch ->> 'isCollapsed')::boolean else is_collapsed end, updated_by = v_actor where workspace_id = p_workspace_id and id = v_entity_id and deleted_at is null;
    elsif v_type = 'section.delete' then
      if v_entity_id is null then raise exception 'section.delete requires entityId' using errcode = '22023'; end if;
      update public.sections set deleted_at = now(), deleted_by = v_actor where workspace_id = p_workspace_id and id = v_entity_id and deleted_at is null;
      update public.tasks set section_id = null, updated_by = v_actor where workspace_id = p_workspace_id and section_id = v_entity_id and deleted_at is null;
    elsif v_type = 'label.add' then
      if v_entity_id is null or nullif(btrim(v_input ->> 'name'), '') is null then raise exception 'label.add requires id and name' using errcode = '22023'; end if;
      insert into public.labels (workspace_id, id, name, color, position, is_favorite, created_by, updated_by)
      values (p_workspace_id, v_entity_id, v_input ->> 'name', coalesce(v_input ->> 'color', 'charcoal'), coalesce((v_input ->> 'order')::numeric, 0), coalesce((v_input ->> 'isFavorite')::boolean, false), v_actor, v_actor);
    elsif v_type = 'label.update' then
      if v_entity_id is null then raise exception 'label.update requires entityId' using errcode = '22023'; end if;
      update public.labels set name = case when v_patch ? 'name' then v_patch ->> 'name' else name end, color = case when v_patch ? 'color' then v_patch ->> 'color' else color end, position = case when v_patch ? 'order' then (v_patch ->> 'order')::numeric else position end, is_favorite = case when v_patch ? 'isFavorite' then (v_patch ->> 'isFavorite')::boolean else is_favorite end, updated_by = v_actor where workspace_id = p_workspace_id and id = v_entity_id and deleted_at is null;
    elsif v_type = 'filter.add' then
      if v_entity_id is null or nullif(btrim(v_input ->> 'name'), '') is null or nullif(btrim(v_input ->> 'query'), '') is null then raise exception 'filter.add requires id, name, and query' using errcode = '22023'; end if;
      insert into public.saved_filters (workspace_id, id, user_id, name, color, query, position, is_favorite, created_by, updated_by)
      values (p_workspace_id, v_entity_id, v_actor, v_input ->> 'name', coalesce(v_input ->> 'color', 'charcoal'), v_input ->> 'query', coalesce((v_input ->> 'order')::numeric, 0), coalesce((v_input ->> 'isFavorite')::boolean, false), v_actor, v_actor);
    elsif v_type = 'filter.update' then
      if v_entity_id is null then raise exception 'filter.update requires entityId' using errcode = '22023'; end if;
      update public.saved_filters set name = case when v_patch ? 'name' then v_patch ->> 'name' else name end, color = case when v_patch ? 'color' then v_patch ->> 'color' else color end, query = case when v_patch ? 'query' then v_patch ->> 'query' else query end, position = case when v_patch ? 'order' then (v_patch ->> 'order')::numeric else position end, is_favorite = case when v_patch ? 'isFavorite' then (v_patch ->> 'isFavorite')::boolean else is_favorite end, updated_by = v_actor where workspace_id = p_workspace_id and id = v_entity_id and user_id = v_actor and deleted_at is null;
    else
      update public.workspace_preferences set
        inbox_project_id = case when v_patch ? 'inboxProjectId' then v_patch ->> 'inboxProjectId' else inbox_project_id end,
        active_project_id = case when v_patch ? 'activeProjectId' then nullif(v_patch ->> 'activeProjectId', '') else active_project_id end,
        onboarding_dismissed = case when v_patch ? 'onboardingDismissed' then (v_patch ->> 'onboardingDismissed')::boolean else onboarding_dismissed end,
        theme = case when v_patch ? 'theme' then v_patch ->> 'theme' else theme end,
        show_completed = case when v_patch ? 'showCompleted' then (v_patch ->> 'showCompleted')::boolean else show_completed end,
        updated_by = v_actor
      where workspace_id = p_workspace_id and user_id = v_actor and deleted_at is null;
      if not found then raise exception 'Workspace preferences are unavailable' using errcode = 'P0002'; end if;
    end if;

    update public.workspaces set updated_by = v_actor where id = p_workspace_id returning revision into v_revision;
    insert into public.mutation_receipts (workspace_id, idempotency_key, actor_id, operation, client_id, request_fingerprint, response)
    values (p_workspace_id, v_mutation_id, v_actor, v_type, p_client_id, encode(digest(v_mutation::text, 'sha256'), 'hex'), jsonb_build_object('status', 'applied', 'revision', v_revision));
    insert into public.workspace_changes (workspace_id, id, client_id, revision, mutation, created_by)
    values (p_workspace_id, v_mutation_id, p_client_id, v_revision, v_mutation, v_actor);
  end loop;

  return public.daymark_get_workspace_snapshot(p_workspace_id);
end;
$$;

-- Compatibility overload for W76's authenticated invitation flow.
create or replace function public.transfer_workspace_ownership(
  p_workspace_id uuid,
  p_successor_user_id uuid
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.transfer_workspace_ownership(
    p_workspace_id,
    p_successor_user_id,
    'transfer:' || gen_random_uuid()::text
  )
$$;

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_bucket public.api_rate_limits;
  v_allowed boolean;
  v_retry_after integer;
begin
  if v_actor is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_key is null or char_length(btrim(p_key)) = 0 or char_length(p_key) > 200
    or p_limit is null or p_limit < 1 or p_limit > 10000
    or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 604800 then
    raise exception 'Invalid rate limit request' using errcode = '22023';
  end if;

  -- Keep the rate-limit table bounded without extending the caller's lock.
  delete from public.api_rate_limits
  where ctid in (
    select ctid
    from public.api_rate_limits
    where updated_at < v_now - interval '7 days'
    order by updated_at
    limit 250
  );

  insert into public.api_rate_limits (
    actor_id, rate_key, window_started_at, request_count, updated_at
  )
  values (v_actor, p_key, v_now, 1, v_now)
  on conflict (actor_id, rate_key) do update
  set
    window_started_at = case
      when public.api_rate_limits.window_started_at
        + make_interval(secs => p_window_seconds) <= v_now then v_now
      else public.api_rate_limits.window_started_at
    end,
    request_count = case
      when public.api_rate_limits.window_started_at
        + make_interval(secs => p_window_seconds) <= v_now then 1
      else public.api_rate_limits.request_count + 1
    end,
    updated_at = v_now
  returning * into v_bucket;

  v_allowed := v_bucket.request_count <= p_limit;
  v_retry_after := case
    when v_allowed then 0
    else greatest(
      0,
      ceil(extract(epoch from (
        v_bucket.window_started_at + make_interval(secs => p_window_seconds) - v_now
      )))::integer
    )
  end;

  return jsonb_build_object(
    'allowed', v_allowed,
    'retry_after_seconds', v_retry_after
  );
end;
$$;

create or replace function public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_invitation public.invitations;
begin
  if v_actor is null or not public.can_manage_workspace(p_workspace_id) then
    raise exception 'Owner access is required' using errcode = '42501';
  end if;
  if char_length(v_email) < 3 or char_length(v_email) > 320
    or position('@' in v_email) <= 1
    or position('.' in split_part(v_email, '@', 2)) <= 1
    or p_role is null or p_role not in ('editor', 'viewer')
    or p_token_hash is null or char_length(btrim(p_token_hash)) < 32 or char_length(p_token_hash) > 128 then
    raise exception 'Invalid invitation request' using errcode = '22023';
  end if;

  update public.invitations
  set status = 'expired', updated_by = v_actor
  where workspace_id = p_workspace_id
    and email = v_email
    and status = 'pending'
    and expires_at <= now()
    and deleted_at is null;

  select * into v_invitation
  from public.invitations
  where workspace_id = p_workspace_id
    and email = v_email
    and status = 'pending'
    and deleted_at is null
  for update;

  if found and v_invitation.token_hash = p_token_hash then
    return jsonb_build_object(
      'id', v_invitation.id,
      'workspaceId', v_invitation.workspace_id,
      'email', v_invitation.email,
      'role', v_invitation.role,
      'status', v_invitation.status,
      'expiresAt', v_invitation.expires_at,
      'createdAt', v_invitation.created_at
    );
  end if;
  if found then
    update public.invitations
    set status = 'revoked', updated_by = v_actor
    where id = v_invitation.id;
  end if;

  insert into public.invitations (
    workspace_id, email, role, token_hash, invited_by, created_by, updated_by
  )
  values (
    p_workspace_id, v_email, p_role::public.workspace_role, p_token_hash,
    v_actor, v_actor, v_actor
  )
  returning * into v_invitation;

  insert into public.activity_events (
    workspace_id, actor_id, kind, payload
  )
  values (
    p_workspace_id,
    v_actor,
    'invitation',
    jsonb_build_object('invitationId', v_invitation.id, 'email', v_email, 'role', v_invitation.role)
  );

  return jsonb_build_object(
    'id', v_invitation.id,
    'workspaceId', v_invitation.workspace_id,
    'email', v_invitation.email,
    'role', v_invitation.role,
    'status', v_invitation.status,
    'expiresAt', v_invitation.expires_at,
    'createdAt', v_invitation.created_at
  );
end;
$$;

create or replace function public.accept_workspace_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_invitation public.invitations;
  v_membership public.workspace_members;
begin
  if v_actor is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_token_hash is null or char_length(btrim(p_token_hash)) < 32 or char_length(p_token_hash) > 128 then
    raise exception 'Invalid invitation token' using errcode = '22023';
  end if;

  select lower(btrim(email)) into v_email
  from auth.users
  where id = v_actor;
  if v_email is null or v_email = '' then
    raise exception 'An account email is required to accept an invitation' using errcode = '22023';
  end if;

  select * into v_invitation
  from public.invitations
  where token_hash = p_token_hash and deleted_at is null
  for update;
  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if v_invitation.email <> v_email then
    raise exception 'Invitation email does not match the authenticated account' using errcode = '42501';
  end if;
  if v_invitation.status = 'accepted' then
    if v_invitation.accepted_by is distinct from v_actor then
      raise exception 'Invitation was already accepted' using errcode = '23505';
    end if;
    select * into v_membership
    from public.workspace_members
    where workspace_id = v_invitation.workspace_id
      and user_id = v_actor
      and deleted_at is null;
    if not found then
      raise exception 'Accepted invitation no longer has an active membership' using errcode = 'P0002';
    end if;
    return jsonb_build_object(
      'workspaceId', v_membership.workspace_id,
      'userId', v_membership.user_id,
      'role', v_membership.role,
      'acceptedAt', v_membership.accepted_at
    );
  end if;
  if v_invitation.status <> 'pending' or v_invitation.expires_at <= now() then
    raise exception 'Invitation is expired or revoked' using errcode = '22023';
  end if;

  select * into v_membership
  from public.workspace_members
  where workspace_id = v_invitation.workspace_id
    and user_id = v_actor
  for update;
  if found and v_membership.deleted_at is null then
    null;
  elsif found then
    update public.workspace_members
    set
      role = v_invitation.role,
      accepted_at = now(),
      deleted_at = null,
      deleted_by = null,
      updated_by = v_actor
    where workspace_id = v_invitation.workspace_id and user_id = v_actor
    returning * into v_membership;
  else
    insert into public.workspace_members (
      workspace_id, user_id, role, accepted_at, created_by, updated_by
    )
    values (
      v_invitation.workspace_id, v_actor, v_invitation.role, now(), v_actor, v_actor
    )
    returning * into v_membership;
  end if;

  update public.invitations
  set status = 'accepted', accepted_by = v_actor, accepted_at = now(), updated_by = v_actor
  where id = v_invitation.id;

  insert into public.activity_events (
    workspace_id, actor_id, kind, payload
  )
  values (
    v_invitation.workspace_id,
    v_actor,
    'member',
    jsonb_build_object('invitationId', v_invitation.id, 'userId', v_actor, 'role', v_membership.role)
  );

  return jsonb_build_object(
    'workspaceId', v_membership.workspace_id,
    'userId', v_membership.user_id,
    'role', v_membership.role,
    'acceptedAt', v_membership.accepted_at
  );
end;
$$;

create or replace function public.enqueue_reminder_delivery(
  p_idempotency_key text,
  p_recipient jsonb,
  p_reminder jsonb,
  p_scheduled_for timestamptz,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_actor_email text;
  v_recipient_user_id uuid;
  v_safe_reminder jsonb;
  v_delivery public.reminder_delivery_queue;
begin
  if v_actor is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(btrim(p_idempotency_key)) = 0 or char_length(p_idempotency_key) > 200
    or p_recipient is null or jsonb_typeof(p_recipient) <> 'object'
    or p_reminder is null or jsonb_typeof(p_reminder) <> 'object'
    or p_scheduled_for is null
    or p_timezone is null or char_length(btrim(p_timezone)) = 0 or char_length(p_timezone) > 100 then
    raise exception 'Invalid reminder delivery request' using errcode = '22023';
  end if;

  v_email := lower(btrim(coalesce(p_recipient ->> 'email', '')));
  if char_length(v_email) < 3 or char_length(v_email) > 320 or position('@' in v_email) <= 1 then
    raise exception 'A valid reminder recipient email is required' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from pg_timezone_names
    where name = btrim(p_timezone)
  ) then
    raise exception 'timezone must be a valid IANA timezone' using errcode = '22023';
  end if;
  select lower(btrim(email)) into v_actor_email
  from auth.users
  where id = v_actor;
  if v_actor_email is null or v_email <> v_actor_email then
    raise exception 'Reminder delivery must target the authenticated account email' using errcode = '42501';
  end if;
  if p_recipient ? 'userId' then
    begin
      v_recipient_user_id := (p_recipient ->> 'userId')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'recipient.userId must be a UUID' using errcode = '22023';
    end;
    if v_recipient_user_id <> v_actor then
      raise exception 'Reminder recipients may only identify the authenticated user' using errcode = '42501';
    end if;
  end if;
  if nullif(btrim(p_reminder ->> 'id'), '') is null
    or nullif(btrim(p_reminder ->> 'taskId'), '') is null
    or nullif(btrim(p_reminder ->> 'taskTitle'), '') is null
    or char_length(p_reminder ->> 'taskTitle') > 500 then
    raise exception 'Invalid reminder payload' using errcode = '22023';
  end if;
  v_safe_reminder := jsonb_build_object(
    'id', p_reminder ->> 'id',
    'taskId', p_reminder ->> 'taskId',
    'taskTitle', p_reminder ->> 'taskTitle'
  );

  insert into public.reminder_delivery_queue (
    requested_by, recipient_user_id, recipient_email, reminder, scheduled_for,
    timezone, idempotency_key
  )
  values (
    v_actor, v_recipient_user_id, v_email, v_safe_reminder, p_scheduled_for,
    btrim(p_timezone), p_idempotency_key
  )
  on conflict (requested_by, idempotency_key) do update
  set updated_at = public.reminder_delivery_queue.updated_at
  returning * into v_delivery;

  return jsonb_build_object(
    'id', v_delivery.id,
    'status', v_delivery.status,
    'scheduledFor', v_delivery.scheduled_for,
    'createdAt', v_delivery.created_at
  );
end;
$$;

create or replace function public.create_data_export(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.export_requests;
begin
  if v_actor is null or not public.can_edit_workspace(p_workspace_id) then
    raise exception 'Editor access is required' using errcode = '42501';
  end if;

  insert into public.export_requests (workspace_id, requested_by)
  values (p_workspace_id, v_actor)
  on conflict (workspace_id, requested_by) where status in ('pending', 'processing')
  do update set updated_at = public.export_requests.updated_at
  returning * into v_request;

  return jsonb_build_object(
    'id', v_request.id,
    'workspaceId', v_request.workspace_id,
    'status', v_request.status,
    'requestedAt', v_request.created_at,
    'expiresAt', v_request.expires_at
  );
end;
$$;

create or replace function public.request_account_deletion(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.account_deletion_requests;
begin
  if v_actor is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(btrim(p_idempotency_key)) = 0 or char_length(p_idempotency_key) > 200 then
    raise exception 'An idempotency key is required' using errcode = '22023';
  end if;

  select * into v_request
  from public.account_deletion_requests
  where user_id = v_actor
  for update;
  if found then
    if v_request.request_idempotency_key <> p_idempotency_key then
      raise exception 'An account deletion request already exists' using errcode = '23505';
    end if;
  else
    insert into public.account_deletion_requests (
      user_id, requested_user_id, request_idempotency_key
    )
    values (v_actor, v_actor, p_idempotency_key)
    returning * into v_request;
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'requestedAt', v_request.requested_at,
    'confirmedAt', v_request.confirmed_at
  );
end;
$$;

create or replace function public.confirm_account_deletion(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.account_deletion_requests;
begin
  if v_actor is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(btrim(p_idempotency_key)) = 0 or char_length(p_idempotency_key) > 200 then
    raise exception 'An idempotency key is required' using errcode = '22023';
  end if;

  select * into v_request
  from public.account_deletion_requests
  where user_id = v_actor
  for update;
  if not found then
    raise exception 'Account deletion must be requested before confirmation' using errcode = 'P0002';
  end if;
  if v_request.status = 'confirmed' then
    if v_request.confirm_idempotency_key is distinct from p_idempotency_key then
      raise exception 'Account deletion confirmation key was already used' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'id', v_request.id,
      'status', v_request.status,
      'requestedAt', v_request.requested_at,
      'confirmedAt', v_request.confirmed_at
    );
  end if;

  -- A personal workspace has no collaborators to protect; shared ownership
  -- must be transferred before the Edge function asks Supabase Auth to delete.
  delete from public.workspaces
  where owner_id = v_actor and is_personal and deleted_at is null;
  if exists (
    select 1
    from public.workspaces
    where owner_id = v_actor and not is_personal and deleted_at is null
  ) then
    raise exception 'Transfer shared workspace ownership before deleting this account' using errcode = '23514';
  end if;

  update public.account_deletion_requests
  set
    status = 'confirmed',
    confirm_idempotency_key = p_idempotency_key,
    confirmed_at = now(),
    updated_at = now()
  where id = v_request.id
  returning * into v_request;

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'requestedAt', v_request.requested_at,
    'confirmedAt', v_request.confirmed_at
  );
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
alter table public.workspace_changes enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.reminder_delivery_queue enable row level security;
alter table public.export_requests enable row level security;
alter table public.account_deletion_requests enable row level security;

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
create policy workspace_changes_member_select on public.workspace_changes
  for select using ((select public.is_workspace_member(workspace_id)));
create policy api_rate_limits_self_select on public.api_rate_limits
  for select using (actor_id = (select auth.uid()));
create policy reminder_delivery_queue_self_select on public.reminder_delivery_queue
  for select using (
    requested_by = (select auth.uid())
    or recipient_user_id = (select auth.uid())
  );
create policy export_requests_member_select on public.export_requests
  for select using ((select public.is_workspace_member(workspace_id)));
create policy account_deletion_requests_self_select on public.account_deletion_requests
  for select using (user_id = (select auth.uid()));

revoke all on function public.workspace_role_for(uuid) from public;
revoke all on function public.workspace_owner_for(uuid) from public;
revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.can_edit_workspace(uuid) from public;
revoke all on function public.can_manage_workspace(uuid) from public;
revoke all on function public.daymark_workspace_state(uuid) from public;
revoke all on function public.daymark_get_workspace_snapshot(uuid) from public;
revoke all on function public.daymark_bootstrap_workspace(text) from public;
revoke all on function public.daymark_apply_workspace_mutations(uuid, text, bigint, jsonb) from public;
revoke all on function public.create_personal_workspace() from public;
revoke all on function public.apply_task_mutation(uuid, text, text, text, bigint, jsonb) from public;
revoke all on function public.transfer_workspace_ownership(uuid, uuid, text) from public;
revoke all on function public.transfer_workspace_ownership(uuid, uuid) from public;
revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.create_workspace_invitation(uuid, text, text, text) from public;
revoke all on function public.accept_workspace_invitation(text) from public;
revoke all on function public.enqueue_reminder_delivery(text, jsonb, jsonb, timestamptz, text) from public;
revoke all on function public.create_data_export(uuid) from public;
revoke all on function public.request_account_deletion(text) from public;
revoke all on function public.confirm_account_deletion(text) from public;
revoke all on function public.enforce_workspace_integrity() from public;
revoke all on function public.log_task_activity() from public;
revoke all on function public.handle_new_user() from public;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles, public.workspaces, public.workspace_members,
  public.workspace_preferences, public.projects, public.sections, public.labels, public.saved_filters,
  public.tasks, public.task_labels, public.task_reminders, public.task_comments, public.activity_events,
  public.invitations, public.mutation_receipts to authenticated;
grant select on public.workspace_changes to authenticated;
grant select on public.reminder_delivery_queue, public.export_requests, public.account_deletion_requests to authenticated;
grant execute on function public.daymark_bootstrap_workspace(text) to authenticated;
grant execute on function public.daymark_get_workspace_snapshot(uuid) to authenticated;
grant execute on function public.daymark_apply_workspace_mutations(uuid, text, bigint, jsonb) to authenticated;
grant execute on function public.create_personal_workspace() to authenticated;
grant execute on function public.apply_task_mutation(uuid, text, text, text, bigint, jsonb) to authenticated;
grant execute on function public.transfer_workspace_ownership(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_workspace_ownership(uuid, uuid) to authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to authenticated;
grant execute on function public.create_workspace_invitation(uuid, text, text, text) to authenticated;
grant execute on function public.accept_workspace_invitation(text) to authenticated;
grant execute on function public.enqueue_reminder_delivery(text, jsonb, jsonb, timestamptz, text) to authenticated;
grant execute on function public.create_data_export(uuid) to authenticated;
grant execute on function public.request_account_deletion(text) to authenticated;
grant execute on function public.confirm_account_deletion(text) to authenticated;
grant execute on function public.workspace_role_for(uuid), public.workspace_owner_for(uuid), public.is_workspace_member(uuid),
  public.can_edit_workspace(uuid), public.can_manage_workspace(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.workspace_changes;
    exception
      when duplicate_object then null;
    end;
  end if;
end;
$$;
