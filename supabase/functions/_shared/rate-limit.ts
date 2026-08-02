import { HttpError } from "./validation.ts";

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export function parseRateLimitResult(value: unknown): RateLimitResult {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>).allowed !== "boolean"
  ) {
    throw new HttpError(503, "Rate limiting is temporarily unavailable.", "rate_limit_unavailable");
  }

  const retryAfterSeconds = Number(
    (value as Record<string, unknown>).retry_after_seconds ?? 0,
  );
  return {
    allowed: (value as Record<string, unknown>).allowed as boolean,
    retryAfterSeconds: Number.isFinite(retryAfterSeconds)
      ? Math.max(0, Math.ceil(retryAfterSeconds))
      : 0,
  };
}

export async function enforceRateLimit(
  client: RpcClient,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const { data, error } = await client.rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error("Rate limit RPC failed", error.message);
    throw new HttpError(503, "Rate limiting is temporarily unavailable.", "rate_limit_unavailable");
  }

  const result = parseRateLimitResult(data);
  if (!result.allowed) {
    throw new HttpError(
      429,
      "Too many requests. Please try again later.",
      "rate_limited",
      { retryAfterSeconds: result.retryAfterSeconds },
    );
  }
}
