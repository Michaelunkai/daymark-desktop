-- Deterministic local-development identities. The signup trigger creates a
-- profile and personal workspace for each user before the shared demo is added.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a101', 'authenticated', 'authenticated', 'alice@daymark.local', crypt('daymark-local', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Alice Owner","timezone":"America/New_York"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b202', 'authenticated', 'authenticated', 'ben@daymark.local', crypt('daymark-local', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Ben Editor","timezone":"Europe/London"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000c303', 'authenticated', 'authenticated', 'casey@daymark.local', crypt('daymark-local', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Casey Viewer","timezone":"Asia/Jerusalem"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000d404', 'authenticated', 'authenticated', 'invitee@daymark.local', crypt('daymark-local', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Drew Invitee","timezone":"America/Chicago"}', now(), now())
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug, owner_id, created_by, updated_by)
values (
  '10000000-0000-0000-0000-000000000001',
  'Daymark product',
  'daymark-product',
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101'
)
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role, created_by, updated_by)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a101', 'owner', '00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a101'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b202', 'editor', '00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a101'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c303', 'viewer', '00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a101')
on conflict (workspace_id, user_id) do nothing;

insert into public.projects (id, workspace_id, name, description, color, position, created_by, updated_by)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Launch day',
  'Tasks for the Daymark launch.',
  'teal',
  1,
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101'
)
on conflict (workspace_id, id) do nothing;

insert into public.workspace_preferences (
  workspace_id, user_id, inbox_project_id, active_project_id, onboarding_dismissed,
  created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000a101',
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  true,
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101'
)
on conflict (workspace_id, user_id) do nothing;

insert into public.sections (id, workspace_id, project_id, name, position, created_by, updated_by)
values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Today',
  1,
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101'
)
on conflict (workspace_id, id) do nothing;

insert into public.labels (id, workspace_id, name, color, position, created_by, updated_by)
values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Focus',
  'teal',
  1,
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101'
)
on conflict (workspace_id, id) do nothing;

insert into public.tasks (
  id, workspace_id, project_id, section_id, content, description, priority, due, position, created_by, updated_by
)
values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'Ship the calendar',
  'Verify month, week, and year navigation.',
  2,
  '{"date":"2026-08-03","time":"09:00","timezone":"America/New_York","recurrence":null}',
  1,
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101'
)
on conflict (workspace_id, id) do nothing;

insert into public.task_labels (task_id, label_id, workspace_id, created_by)
values (
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000a101'
)
on conflict (workspace_id, task_id, label_id) do nothing;

insert into public.task_reminders (id, workspace_id, task_id, remind_at, delivery_key, created_by, updated_by)
values (
  '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-03T08:45:00Z',
  'demo-calendar-reminder-v1',
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101'
)
on conflict (workspace_id, id) do nothing;

insert into public.saved_filters (id, workspace_id, user_id, name, query, position, created_by, updated_by)
values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000a101',
  'Launch work',
  'project:"Launch day" completed:false',
  1,
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101'
)
on conflict (workspace_id, id) do nothing;

insert into public.invitations (
  id, workspace_id, email, role, token_hash, invited_by, created_by, updated_by
)
values (
  '80000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'invitee@daymark.local',
  'viewer',
  encode(digest('daymark-demo-invitation', 'sha256'), 'hex'),
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101',
  '00000000-0000-0000-0000-00000000a101'
)
on conflict (id) do nothing;
