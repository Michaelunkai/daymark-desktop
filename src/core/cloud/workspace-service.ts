import type { SupabaseRpcClient } from "./supabase-client";

export type CloudWorkspace = {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
};

export interface WorkspaceService {
  bootstrap(input?: { name?: string }): Promise<CloudWorkspace>;
}

export function createWorkspaceService(
  client: Pick<SupabaseRpcClient, "rpc">,
  options: { bootstrapRpc?: string } = {},
): WorkspaceService {
  const bootstrapRpc = options.bootstrapRpc ?? "daymark_bootstrap_workspace";

  return {
    async bootstrap(input = {}) {
      const { data, error } = await client.rpc<CloudWorkspace>(bootstrapRpc, {
        workspace_name: input.name?.trim() || null,
      });
      if (error) throw error;
      if (!data?.id || !data.ownerId) throw new Error("Workspace bootstrap returned an invalid workspace.");
      return data;
    },
  };
}
