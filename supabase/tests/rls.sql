-- Run after the migration and seed with `psql -f supabase/tests/rls.sql`.
-- Each block deliberately assumes the Supabase `authenticated` database role.

do $$
begin
  if (select count(*) from public.profiles where id in (
    '00000000-0000-0000-0000-00000000a101'::uuid,
    '00000000-0000-0000-0000-00000000b202'::uuid,
    '00000000-0000-0000-0000-00000000c303'::uuid
  )) <> 3 then
    raise exception 'signup bootstrap should create each seeded profile';
  end if;
  if (select count(*) from public.workspaces where is_personal and owner_id in (
    '00000000-0000-0000-0000-00000000a101'::uuid,
    '00000000-0000-0000-0000-00000000b202'::uuid,
    '00000000-0000-0000-0000-00000000c303'::uuid
  )) <> 3 then
    raise exception 'signup bootstrap should create one personal workspace per user';
  end if;
end;
$$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a101', true);

do $$
declare
  changed integer;
  result jsonb;
begin
  if (select count(*) from public.tasks where workspace_id = '10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'owner should see the shared workspace task';
  end if;

  result := public.apply_task_mutation(
    '10000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000001',
    'update',
    '50000000-0000-0000-0000-000000000001',
    1,
    '{"content":"Ship the verified calendar"}'
  );
  if result ->> 'status' <> 'applied' then
    raise exception 'owner mutation should be applied';
  end if;

  result := public.apply_task_mutation(
    '10000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000001',
    'update',
    '50000000-0000-0000-0000-000000000001',
    1,
    '{"content":"must not apply twice"}'
  );
  if result #>> '{task,revision}' <> '2' then
    raise exception 'idempotency replay should return the original response';
  end if;

  begin
    update public.workspaces
    set owner_id = '00000000-0000-0000-0000-00000000b202'
    where id = '10000000-0000-0000-0000-000000000001';
  exception
    when insufficient_privilege then null;
  end;
  if (select owner_id from public.workspaces where id = '10000000-0000-0000-0000-000000000001')
    <> '00000000-0000-0000-0000-00000000a101'::uuid then
    raise exception 'direct ownership changes must be rejected';
  end if;

  update public.workspace_members
  set role = 'viewer'
  where workspace_id = '10000000-0000-0000-0000-000000000001'
    and user_id = '00000000-0000-0000-0000-00000000b202';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'owner should manage member roles';
  end if;

  result := public.transfer_workspace_ownership(
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-00000000b202',
    '90000000-0000-0000-0000-000000000002'
  );
  if result ->> 'status' <> 'applied' or result ->> 'owner_id' <> '00000000-0000-0000-0000-00000000b202' then
    raise exception 'ownership transfer should return the new owner';
  end if;
  if (select owner_id from public.workspaces where id = '10000000-0000-0000-0000-000000000001')
    <> '00000000-0000-0000-0000-00000000b202'::uuid then
    raise exception 'ownership transfer should update the workspace owner';
  end if;
  if (select role from public.workspace_members where workspace_id = '10000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000a101')
    <> 'editor'::public.workspace_role then
    raise exception 'ownership transfer should demote the prior owner';
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b202', true);

do $$
declare
  changed integer;
begin
  if (select count(*) from public.projects where workspace_id = '10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'editor should see shared projects';
  end if;

  update public.tasks
  set description = 'Editor added this note.'
  where id = '50000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'editor should update tasks';
  end if;

  update public.workspace_members
  set role = 'owner'
  where workspace_id = '10000000-0000-0000-0000-000000000001'
    and user_id = '00000000-0000-0000-0000-00000000c303';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'editor must not manage membership';
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c303', true);

do $$
declare
  changed integer;
begin
  if (select count(*) from public.tasks where workspace_id = '10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'viewer should see shared tasks';
  end if;

  update public.tasks
  set content = 'Viewer must not edit'
  where id = '50000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'viewer must not edit tasks';
  end if;

  if exists (
    select 1 from public.saved_filters
    where workspace_id = '10000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'viewer must not see another user saved filters';
  end if;

  begin
    perform public.transfer_workspace_ownership(
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-00000000b202',
      '90000000-0000-0000-0000-000000000003'
    );
    raise exception 'viewer must not transfer ownership';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
rollback;
