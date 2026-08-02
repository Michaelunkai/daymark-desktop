import type { AppState } from "../types";
import type { RealtimePayload, SupabaseRealtimeChannel, SupabaseRpcClient } from "./supabase-client";

export type CloudMutation = {
  id: string;
  clientId: string;
  type: string;
  entityId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type CloudChange = {
  id: string;
  workspaceId: string;
  clientId: string;
  revision: number;
  mutation: CloudMutation;
};

export type CloudSyncSnapshot = {
  revision: number;
  state: AppState;
};

export type CloudRepositoryOptions = {
  workspaceId: string;
  clientId: string;
  snapshotRpc?: string;
  pushRpc?: string;
  changesTable?: string;
  schema?: string;
};

export interface CloudRepository {
  pull(): Promise<CloudSyncSnapshot>;
  push(mutations: CloudMutation[], expectedRevision: number): Promise<CloudSyncSnapshot>;
  subscribe(listener: (change: CloudChange) => void): () => void;
}

export function createSupabaseRepository(
  client: Pick<SupabaseRpcClient, "rpc" | "channel" | "removeChannel">,
  options: CloudRepositoryOptions,
): CloudRepository {
  const snapshotRpc = options.snapshotRpc ?? "daymark_get_workspace_snapshot";
  const pushRpc = options.pushRpc ?? "daymark_apply_workspace_mutations";
  const changesTable = options.changesTable ?? "workspace_changes";
  const schema = options.schema ?? "public";
  const seenChangeIds = new Set<string>();

  return {
    async pull() {
      const { data, error } = await client.rpc<CloudSyncSnapshot>(snapshotRpc, { workspace_id: options.workspaceId });
      if (error) throw error;
      return validateSnapshot(data);
    },
    async push(mutations, expectedRevision) {
      const { data, error } = await client.rpc<CloudSyncSnapshot>(pushRpc, {
        workspace_id: options.workspaceId,
        client_id: options.clientId,
        expected_revision: expectedRevision,
        mutations,
      });
      if (error) throw error;
      for (const mutation of mutations) remember(seenChangeIds, mutation.id);
      return validateSnapshot(data);
    },
    subscribe(listener) {
      const channel = client
        .channel(`daymark:workspace:${options.workspaceId}`)
        .on("postgres_changes", {
          event: "*",
          schema,
          table: changesTable,
          filter: `workspace_id=eq.${options.workspaceId}`,
        }, (payload) => {
          const change = parseChange(payload);
          if (!change || change.workspaceId !== options.workspaceId || change.clientId === options.clientId) return;
          if (seenChangeIds.has(change.id)) return;
          remember(seenChangeIds, change.id);
          listener(change);
        })
        .subscribe();

      return () => disposeChannel(client, channel);
    },
  };
}

function validateSnapshot(value: CloudSyncSnapshot | null): CloudSyncSnapshot {
  if (!value || typeof value.revision !== "number" || !value.state) {
    throw new Error("Cloud sync returned an invalid snapshot.");
  }
  return value;
}

function parseChange(payload: RealtimePayload): CloudChange | null {
  if (payload.eventType === "DELETE") return null;
  const value = payload.new;
  if (
    typeof value.id !== "string" ||
    typeof value.workspace_id !== "string" ||
    typeof value.client_id !== "string" ||
    typeof value.revision !== "number" ||
    !isRecord(value.mutation)
  ) return null;

  return {
    id: value.id,
    workspaceId: value.workspace_id,
    clientId: value.client_id,
    revision: value.revision,
    mutation: value.mutation as unknown as CloudMutation,
  };
}

function remember(values: Set<string>, value: string): void {
  values.add(value);
  if (values.size > 500) values.delete(values.values().next().value as string);
}

function disposeChannel(
  client: Pick<SupabaseRpcClient, "removeChannel">,
  channel: SupabaseRealtimeChannel,
): void {
  void Promise.resolve(channel.unsubscribe()).then(() => client.removeChannel?.(channel));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
