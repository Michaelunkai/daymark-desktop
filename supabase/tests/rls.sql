-- Run after the migration and seed with `psql -f supabase/tests/rls.sql`.
-- Each block deliberately assumes the Supabase `authenticated` database role.

do $$
begin
  if (select count(*) from public.profiles where id in (
    '00000000-0000-0000-0000-00000000a101'::uuid,
    '00000000-0000-0000-0000-00000000b202'::uuid,
    '00000000-0000-0000-0000-00000000c303'::uuid,
    '00000000-0000-0000-0000-00000000d404'::uuid
  )) <> 4 then
    raise exception 'signup bootstrap should create each seeded profile';
  end if;
  if (select count(*) from public.workspaces where is_personal and owner_id in (
    '00000000-0000-0000-0000-00000000a101'::uuid,
    '00000000-0000-0000-0000-00000000b202'::uuid,
    '00000000-0000-0000-0000-00000000c303'::uuid,
    '00000000-0000-0000-0000-00000000d404'::uuid
  )) <> 4 then
    raise exception 'signup bootstrap should create one personal workspace per user';
  end if;
end;
$$;

-- Cloud contract: camelCase bootstrap/snapshot state, ordered mutation replay,
-- optimistic revision checks, and foreign-workspace rejection.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a101', true);

do $$
declare
  bootstrap jsonb;
  snapshot jsonb;
  replay jsonb;
  change_count integer;
begin
  bootstrap := public.daymark_bootstrap_workspace('Alice Cloud');
  if bootstrap ->> 'ownerId' <> '00000000-0000-0000-0000-00000000a101'
    or bootstrap ->> 'name' <> 'Alice Cloud'
    or bootstrap ->> 'id' is null
    or bootstrap ->> 'createdAt' is null then
    raise exception 'bootstrap must return the CloudWorkspace camelCase contract';
  end if;
  if (select count(*) from public.workspaces
      where owner_id = '00000000-0000-0000-0000-00000000a101'
        and is_personal and deleted_at is null) <> 1 then
    raise exception 'bootstrap must remain idempotent for a personal workspace';
  end if;

  snapshot := public.daymark_get_workspace_snapshot('10000000-0000-0000-0000-000000000001');
  if snapshot ->> 'revision' <> '1'
    or snapshot #>> '{state,schemaVersion}' <> '2'
    or snapshot #>> '{state,projects,20000000-0000-0000-0000-000000000001,id}' <> '20000000-0000-0000-0000-000000000001'
    or snapshot #>> '{state,preferences,inboxProjectId}' <> '20000000-0000-0000-0000-000000000001'
    or jsonb_typeof(snapshot #> '{state,undoStack}') <> 'array' then
    raise exception 'pull must return the AppState snapshot contract';
  end if;

  snapshot := public.daymark_apply_workspace_mutations(
    '10000000-0000-0000-0000-000000000001',
    'cloud-client-alice',
    1,
    '[
      {
        "id":"cloud-task-add-1",
        "clientId":"cloud-client-alice",
        "type":"task.add",
        "entityId":"task-cloud-1",
        "payload":{
          "input":{
            "id":"task-cloud-1",
            "content":"Cloud task",
            "description":"Created through the cloud contract.",
            "projectId":"20000000-0000-0000-0000-000000000001",
            "sectionId":"30000000-0000-0000-0000-000000000001",
            "labelIds":["40000000-0000-0000-0000-000000000001"],
            "priority":2,
            "order":2
          }
        },
        "occurredAt":"2026-08-02T09:00:00Z"
      },
      {
        "id":"cloud-task-update-1",
        "clientId":"cloud-client-alice",
        "type":"task.update",
        "entityId":"task-cloud-1",
        "payload":{"taskId":"task-cloud-1","patch":{"content":"Cloud task updated","order":3}},
        "occurredAt":"2026-08-02T09:01:00Z"
      }
    ]'::jsonb
  );
  if snapshot ->> 'revision' <> '3'
    or snapshot #>> '{state,tasks,task-cloud-1,content}' <> 'Cloud task updated'
    or snapshot #>> '{state,tasks,task-cloud-1,labelIds,0}' <> '40000000-0000-0000-0000-000000000001' then
    raise exception 'ordered cloud mutations must return the post-commit snapshot';
  end if;
  select count(*) into change_count
  from public.workspace_changes
  where workspace_id = '10000000-0000-0000-0000-000000000001'
    and client_id = 'cloud-client-alice';
  if change_count <> 2 then
    raise exception 'each ordered cloud mutation must publish one workspace change';
  end if;

  replay := public.daymark_apply_workspace_mutations(
    '10000000-0000-0000-0000-000000000001',
    'cloud-client-alice',
    1,
    '[
      {
        "id":"cloud-task-add-1",
        "clientId":"cloud-client-alice",
        "type":"task.add",
        "entityId":"task-cloud-1",
        "payload":{
          "input":{
            "id":"task-cloud-1",
            "content":"Cloud task",
            "description":"Created through the cloud contract.",
            "projectId":"20000000-0000-0000-0000-000000000001",
            "sectionId":"30000000-0000-0000-0000-000000000001",
            "labelIds":["40000000-0000-0000-0000-000000000001"],
            "priority":2,
            "order":2
          }
        },
        "occurredAt":"2026-08-02T09:00:00Z"
      },
      {
        "id":"cloud-task-update-1",
        "clientId":"cloud-client-alice",
        "type":"task.update",
        "entityId":"task-cloud-1",
        "payload":{"taskId":"task-cloud-1","patch":{"content":"Cloud task updated","order":3}},
        "occurredAt":"2026-08-02T09:01:00Z"
      }
    ]'::jsonb
  );
  if replay ->> 'revision' <> '3'
    or (select count(*) from public.workspace_changes where workspace_id = '10000000-0000-0000-0000-000000000001' and client_id = 'cloud-client-alice') <> 2 then
    raise exception 'replayed cloud mutations must deduplicate without a new revision or event';
  end if;

  begin
    perform public.daymark_apply_workspace_mutations(
      '10000000-0000-0000-0000-000000000001',
      'cloud-client-alice',
      3,
      '[{
        "id":"cloud-task-add-1",
        "clientId":"cloud-client-alice",
        "type":"task.add",
        "entityId":"task-cloud-1",
        "payload":{"input":{"id":"task-cloud-1","content":"changed replay","projectId":"20000000-0000-0000-0000-000000000001"}},
        "occurredAt":"2026-08-02T09:02:00Z"
      }]'::jsonb
    );
    raise exception 'reusing an idempotency key with a changed mutation must fail';
  exception
    when unique_violation then null;
  end;

  begin
    perform public.daymark_apply_workspace_mutations(
      '10000000-0000-0000-0000-000000000001',
      'cloud-client-alice',
      1,
      '[{
        "id":"cloud-stale-1",
        "clientId":"cloud-client-alice",
        "type":"label.add",
        "entityId":"label-stale-1",
        "payload":{"input":{"id":"label-stale-1","name":"Stale"}},
        "occurredAt":"2026-08-02T09:03:00Z"
      }]'::jsonb
    );
    raise exception 'stale cloud revisions must fail';
  exception
    when serialization_failure then null;
  end;

  begin
    perform public.daymark_apply_workspace_mutations(
      '10000000-0000-0000-0000-000000000001',
      'cloud-client-alice',
      3,
      '[{
        "id":"cloud-cross-workspace-1",
        "clientId":"cloud-client-alice",
        "type":"task.add",
        "entityId":"task-cross-workspace-1",
        "payload":{"input":{"id":"task-cross-workspace-1","content":"Wrong project","projectId":"project-inbox"}},
        "occurredAt":"2026-08-02T09:04:00Z"
      }]'::jsonb
    );
    raise exception 'foreign-workspace entity references must fail';
  exception
    when foreign_key_violation or check_violation then null;
  end;

  begin
    perform public.daymark_apply_workspace_mutations(
      '10000000-0000-0000-0000-000000000001',
      'cloud-client-alice',
      3,
      '{}'::jsonb
    );
    raise exception 'malformed mutation arrays must fail';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;
rollback;

-- W76 durable Edge/RPC contracts: rate limiting, invitations, reminders,
-- exports, and staged account deletion all remain deterministic under RLS.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a101', true);

do $$
declare
  rate_result jsonb;
  invitation_first jsonb;
  invitation_replay jsonb;
  invitation_replaced jsonb;
  delivery_first jsonb;
  delivery_replay jsonb;
  export_first jsonb;
  export_replay jsonb;
  deletion_request jsonb;
begin
  rate_result := public.consume_rate_limit('rls-rate-owner', 1, 3600);
  if rate_result ->> 'allowed' <> 'true' or rate_result ->> 'retry_after_seconds' <> '0' then
    raise exception 'the first authenticated rate-limit request must be allowed';
  end if;
  rate_result := public.consume_rate_limit('rls-rate-owner', 1, 3600);
  if rate_result ->> 'allowed' <> 'false'
    or coalesce((rate_result ->> 'retry_after_seconds')::integer, 0) < 1 then
    raise exception 'the second rate-limit request must return a retry delay';
  end if;

  invitation_first := public.create_workspace_invitation(
    '10000000-0000-0000-0000-000000000001',
    'PERSON@EXAMPLE.COM',
    'viewer',
    encode(digest('owner-person-token-v1', 'sha256'), 'hex')
  );
  invitation_replay := public.create_workspace_invitation(
    '10000000-0000-0000-0000-000000000001',
    'person@example.com',
    'viewer',
    encode(digest('owner-person-token-v1', 'sha256'), 'hex')
  );
  if invitation_first ->> 'id' <> invitation_replay ->> 'id'
    or invitation_first ->> 'email' <> 'person@example.com'
    or invitation_first ->> 'status' <> 'pending' then
    raise exception 'owner invitation creation must normalize and replay safely';
  end if;
  invitation_replaced := public.create_workspace_invitation(
    '10000000-0000-0000-0000-000000000001',
    'person@example.com',
    'editor',
    encode(digest('owner-person-token-v2', 'sha256'), 'hex')
  );
  if invitation_replaced ->> 'id' = invitation_first ->> 'id'
    or invitation_replaced ->> 'role' <> 'editor'
    or (select count(*) from public.invitations
        where workspace_id = '10000000-0000-0000-0000-000000000001'
          and email = 'person@example.com'
          and status = 'pending'
          and deleted_at is null) <> 1 then
    raise exception 'a replacement invitation must leave exactly one pending email invite';
  end if;

  delivery_first := public.enqueue_reminder_delivery(
    'rls-reminder-owner-1',
    '{"email":"alice@daymark.local","userId":"00000000-0000-0000-0000-00000000a101","providerApiKey":"must-not-persist"}',
    '{"id":"reminder-owner-1","taskId":"50000000-0000-0000-0000-000000000001","taskTitle":"Ship the calendar","providerSecret":"must-not-persist"}',
    now() + interval '1 hour',
    'America/New_York'
  );
  delivery_replay := public.enqueue_reminder_delivery(
    'rls-reminder-owner-1',
    '{"email":"alice@daymark.local","userId":"00000000-0000-0000-0000-00000000a101"}',
    '{"id":"reminder-owner-1","taskId":"50000000-0000-0000-0000-000000000001","taskTitle":"Ship the calendar"}',
    now() + interval '1 hour',
    'America/New_York'
  );
  if delivery_first ->> 'id' <> delivery_replay ->> 'id'
    or (select count(*) from public.reminder_delivery_queue
        where requested_by = '00000000-0000-0000-0000-00000000a101'
          and idempotency_key = 'rls-reminder-owner-1') <> 1
    or exists (
      select 1 from public.reminder_delivery_queue
      where id = (delivery_first ->> 'id')::uuid
        and reminder ? 'providerSecret'
    ) then
    raise exception 'reminder delivery must deduplicate and retain only provider-neutral payload';
  end if;

  export_first := public.create_data_export('10000000-0000-0000-0000-000000000001');
  export_replay := public.create_data_export('10000000-0000-0000-0000-000000000001');
  if export_first ->> 'id' <> export_replay ->> 'id'
    or export_first ->> 'status' <> 'pending'
    or export_first ? 'signedUrl' then
    raise exception 'export requests must be durable metadata without a fake download URL';
  end if;

  deletion_request := public.request_account_deletion('rls-delete-owner-request-1');
  if deletion_request ->> 'status' <> 'requested'
    or (public.request_account_deletion('rls-delete-owner-request-1') ->> 'id') <> deletion_request ->> 'id' then
    raise exception 'account deletion request must be retry-safe';
  end if;
  begin
    perform public.confirm_account_deletion('rls-delete-owner-confirm-1');
    raise exception 'shared workspace owners must transfer ownership before confirmation';
  exception
    when check_violation then null;
  end;
  if (select status from public.account_deletion_requests
      where user_id = '00000000-0000-0000-0000-00000000a101') <> 'requested' then
    raise exception 'blocked account deletion must remain staged but unconfirmed';
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b202', true);

do $$
declare
  export_request jsonb;
begin
  begin
    perform public.create_workspace_invitation(
      '10000000-0000-0000-0000-000000000001',
      'editor-cannot-invite@daymark.local',
      'viewer',
      encode(digest('editor-invite-token', 'sha256'), 'hex')
    );
    raise exception 'editors must not create workspace invitations';
  exception
    when insufficient_privilege then null;
  end;

  export_request := public.create_data_export('10000000-0000-0000-0000-000000000001');
  if export_request ->> 'status' <> 'pending' then
    raise exception 'editors must be able to request a workspace export';
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d404', true);

do $$
declare
  membership jsonb;
  replay jsonb;
begin
  begin
    perform public.create_data_export('10000000-0000-0000-0000-000000000001');
    raise exception 'non-members must not request workspace exports';
  exception
    when insufficient_privilege then null;
  end;

  membership := public.accept_workspace_invitation(
    encode(digest('daymark-demo-invitation', 'sha256'), 'hex')
  );
  replay := public.accept_workspace_invitation(
    encode(digest('daymark-demo-invitation', 'sha256'), 'hex')
  );
  if membership ->> 'workspaceId' <> '10000000-0000-0000-0000-000000000001'
    or membership ->> 'role' <> 'viewer'
    or replay ->> 'userId' <> '00000000-0000-0000-0000-00000000d404' then
    raise exception 'matching invitees must accept exactly once and replay safely';
  end if;
  begin
    perform public.create_data_export('10000000-0000-0000-0000-000000000001');
    raise exception 'accepted viewer invites must not gain export permission';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a101', true);
update public.invitations
set expires_at = now() - interval '1 minute'
where id = '80000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d404', true);

do $$
begin
  begin
    perform public.accept_workspace_invitation(
      encode(digest('daymark-demo-invitation', 'sha256'), 'hex')
    );
    raise exception 'expired invitations must not create memberships';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c303', true);

do $$
begin
  begin
    perform public.accept_workspace_invitation(
      encode(digest('daymark-demo-invitation', 'sha256'), 'hex')
    );
    raise exception 'an invitation token must be bound to the invitee email';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform public.create_workspace_invitation(
      '10000000-0000-0000-0000-000000000001',
      'viewer-cannot-invite@daymark.local',
      'viewer',
      encode(digest('viewer-invite-token', 'sha256'), 'hex')
    );
    raise exception 'viewers must not create invitations';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform public.create_data_export('10000000-0000-0000-0000-000000000001');
    raise exception 'viewers must not request workspace exports';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b202', true);

do $$
declare
  requested jsonb;
  confirmed jsonb;
begin
  requested := public.request_account_deletion('rls-delete-editor-request-1');
  confirmed := public.confirm_account_deletion('rls-delete-editor-confirm-1');
  if requested ->> 'status' <> 'requested'
    or confirmed ->> 'status' <> 'confirmed'
    or (public.confirm_account_deletion('rls-delete-editor-confirm-1') ->> 'id') <> confirmed ->> 'id'
    or exists (
      select 1 from public.workspaces
      where owner_id = '00000000-0000-0000-0000-00000000b202'
        and is_personal and deleted_at is null
    ) then
    raise exception 'non-owner account deletion must stage, clean personal data, and replay safely';
  end if;
end;
$$;
rollback;

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
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c303', true);

do $$
declare
  snapshot jsonb;
begin
  snapshot := public.daymark_get_workspace_snapshot('10000000-0000-0000-0000-000000000001');
  if snapshot #>> '{state,tasks,50000000-0000-0000-0000-000000000001,id}' <> '50000000-0000-0000-0000-000000000001' then
    raise exception 'viewers must be able to pull a member workspace snapshot';
  end if;

  begin
    perform public.daymark_apply_workspace_mutations(
      '10000000-0000-0000-0000-000000000001',
      'cloud-client-casey',
      1,
      '[{
        "id":"cloud-viewer-denied-1",
        "clientId":"cloud-client-casey",
        "type":"label.add",
        "entityId":"label-viewer-denied-1",
        "payload":{"input":{"id":"label-viewer-denied-1","name":"Denied"}},
        "occurredAt":"2026-08-02T10:00:00Z"
      }]'::jsonb
    );
    raise exception 'viewers must not push cloud mutations';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.daymark_get_workspace_snapshot((
      select id from public.workspaces
      where owner_id = '00000000-0000-0000-0000-00000000a101'
        and is_personal and deleted_at is null
      limit 1
    ));
    raise exception 'cross-workspace pulls must fail';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.daymark_apply_workspace_mutations(
      (
        select id from public.workspaces
        where owner_id = '00000000-0000-0000-0000-00000000a101'
          and is_personal and deleted_at is null
        limit 1
      ),
      'cloud-client-casey',
      1,
      '[{
        "id":"cloud-nonmember-denied-1",
        "clientId":"cloud-client-casey",
        "type":"label.add",
        "entityId":"label-nonmember-denied-1",
        "payload":{"input":{"id":"label-nonmember-denied-1","name":"Denied"}},
        "occurredAt":"2026-08-02T10:01:00Z"
      }]'::jsonb
    );
    raise exception 'non-members must not push cloud mutations';
  exception
    when insufficient_privilege then null;
  end;
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
