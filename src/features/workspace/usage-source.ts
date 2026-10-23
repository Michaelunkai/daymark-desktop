/**
 * Usage snapshot source for the always-visible 5-hour / 7-day usage meters.
 *
 * DATA CONTRACT (consumed by UsageMeters.tsx):
 *   window.__daymarkUsage() -> UsageSnapshot | null
 *   usedPct is 0..100 ALREADY USED (0 when unknown); a window is null when it
 *   cannot be derived; the whole snapshot is null when nothing is derivable.
 *
 * WHERE THE DATA COMES FROM (local-only, read-only; nothing leaves the machine):
 *   - Electron main (desktop/main.mjs, IPC channel "daymark:usage") reads
 *     C:\Users\Admin\.zcode\cli\db\db.sqlite (ZCode CLI local database), table
 *     `model_usage` (per-request token accounting: completed_at epoch-ms +
 *     computed_total_tokens), summing tokens over the trailing 5h and 7d
 *     windows. Searched first: .zcode/v2/*.json state files, cli/config.json,
 *     credentials.json (key names only - never loaded here), v2/logs, and the
 *     cli/db sqlite schema; `model_usage` is the freshest and most complete
 *     local source (row count ~10k, rows arrive within seconds of a request).
 *   - WHAT IS MISSING LOCALLY: the plan quota itself. The entitlement snapshot
 *     (plan limits) is fetched from the remote zcode-host via RPC
 *     (usage-stats.getEntitlementSnapshot in v2/logs) and is NOT persisted to
 *     any readable local file. Without a limit, a percentage cannot be derived
 *     honestly, so main.mjs only reports usedPct when a limit is supplied via
 *     DAYMARK_USAGE_5H_LIMIT_TOKENS / DAYMARK_USAGE_7D_LIMIT_TOKENS env vars;
 *     otherwise both windows are null and the meters hide gracefully.
 *     resetsAtMs is likewise not derivable locally (no window anchor) and is
 *     omitted.
 *
 * DEV MOCK (no Electron needed): set localStorage "daymark.usageMock" to e.g.
 *   "40,10" -> fiveHour used 40%, sevenDay used 10% (deterministic: same value
 *   in, same snapshot out; no clocks, no random). Clear it to go live again.
 */

export type UsageWindow = {
  /** Percent 0..100 that is ALREADY USED (not remaining). */
  usedPct: number;
  /** Epoch-ms when the window resets, when derivable. */
  resetsAtMs?: number;
};

export type UsageSnapshot = {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  updatedAtMs?: number;
};

const USAGE_MOCK_STORAGE_KEY = "daymark.usageMock";

function clampUsedPct(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/** Parse a deterministic mock like "40,10" -> { fiveHour: 40, sevenDay: 10 }. */
function parseUsageMock(raw: string): UsageSnapshot {
  const parts = raw.split(",").map((part) => clampUsedPct(Number(part.trim())));
  return {
    fiveHour: { usedPct: parts[0] ?? 0 },
    sevenDay: { usedPct: parts[1] ?? parts[0] ?? 0 },
  };
}

/**
 * Read the current usage snapshot synchronously.
 *
 * Order of precedence:
 *   1. Dev mock from localStorage["daymark.usageMock"] (deterministic).
 *   2. window.__daymarkUsage() exposed by desktop/preload.cjs (sync cache of
 *      the "daymark:usage" IPC round-trip).
 *   3. null -> meters hide.
 */
export function readUsageSnapshot(): UsageSnapshot | null {
  try {
    if (typeof localStorage !== "undefined") {
      const mock = localStorage.getItem(USAGE_MOCK_STORAGE_KEY);
      if (mock !== null && mock.trim() !== "") return parseUsageMock(mock);
    }
  } catch {
    // localStorage unavailable (SSR/security context) -> fall through.
  }

  if (typeof window === "undefined") return null;
  const read = (window as unknown as { __daymarkUsage?: () => unknown }).__daymarkUsage;
  if (typeof read !== "function") return null;

  let result: unknown;
  try {
    result = read();
  } catch {
    return null;
  }
  // Defensive: a preload variant returning a Promise must not leak into the
  // sync contract - treat it as "not available yet" rather than bad data.
  if (!result || typeof result !== "object" || typeof (result as Promise<unknown>).then === "function") {
    return null;
  }

  const snapshot = result as Partial<UsageSnapshot>;
  const normalizeWindow = (usage: unknown): UsageWindow | null => {
    if (!usage || typeof usage !== "object" || typeof (usage as UsageWindow).usedPct !== "number") {
      return null;
    }
    const window: UsageWindow = { usedPct: clampUsedPct((usage as UsageWindow).usedPct) };
    const resetsAtMs = (usage as UsageWindow).resetsAtMs;
    if (typeof resetsAtMs === "number" && Number.isFinite(resetsAtMs)) window.resetsAtMs = resetsAtMs;
    return window;
  };

  return {
    fiveHour: normalizeWindow(snapshot.fiveHour),
    sevenDay: normalizeWindow(snapshot.sevenDay),
    ...(typeof snapshot.updatedAtMs === "number" && Number.isFinite(snapshot.updatedAtMs)
      ? { updatedAtMs: snapshot.updatedAtMs }
      : {}),
  };
}

// SLICE-DONE: data-engineer

// ---------------------------------------------------------------------------
// Quota-preferred snapshot (remaining %)
//
// PREFERRED CONTRACT: the desktop host exposes window.__daymarkUsageQuota()
// (IPC "daymark:usage-quota") returning:
//   { fiveHour: { remainingPct, resetsAtMs?, updatedAt }, sevenDay: { ... } }
// where remainingPct is 0..100 REMAINING and updatedAt is epoch-ms of the
// reading. Falls back, in order, to the localStorage cache
// "daymark.usageQuotaCache" (same shape; flagged stale when older than
// QUOTA_STALE_MS) and finally to the legacy window.__daymarkUsage() used-pct
// contract (remaining derived as 100 - used; never stale-flagged).
// ---------------------------------------------------------------------------

export type QuotaWindow = {
  /** Percent 0..100 that is REMAINING (not used). */
  remainingPct: number;
  resetsAtMs?: number;
  /** Epoch-ms of the underlying reading, when known. */
  updatedAt?: number;
};

export type UsageQuotaSnapshot = {
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  /** True when the reading came from a cache older than QUOTA_STALE_MS. */
  stale: boolean;
};

export const QUOTA_STALE_MS = 30 * 60 * 1000;
export const USAGE_QUOTA_CACHE_STORAGE_KEY = "daymark.usageQuotaCache";

function clampRemainingPct(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function normalizeQuotaWindow(usage: unknown): QuotaWindow | null {
  if (!usage || typeof usage !== "object") return null;
  const remainingPct = (usage as QuotaWindow).remainingPct;
  if (typeof remainingPct !== "number") return null;
  const window: QuotaWindow = { remainingPct: clampRemainingPct(remainingPct) };
  const resetsAtMs = (usage as QuotaWindow).resetsAtMs;
  if (typeof resetsAtMs === "number" && Number.isFinite(resetsAtMs)) window.resetsAtMs = resetsAtMs;
  const updatedAt = (usage as QuotaWindow).updatedAt;
  if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) window.updatedAt = updatedAt;
  return window;
}

function normalizeQuotaSnapshot(result: unknown): UsageQuotaSnapshot | null {
  if (!result || typeof result !== "object" || typeof (result as Promise<unknown>).then === "function") {
    return null;
  }
  const snapshot = result as Partial<UsageQuotaSnapshot>;
  const fiveHour = normalizeQuotaWindow(snapshot.fiveHour);
  const sevenDay = normalizeQuotaWindow(snapshot.sevenDay);
  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay, stale: snapshot.stale === true };
}

function quotaUpdatedAtMs(snapshot: UsageQuotaSnapshot): number | null {
  const stamps = [snapshot.fiveHour?.updatedAt, snapshot.sevenDay?.updatedAt].filter(
    (value): value is number => typeof value === "number",
  );
  if (!stamps.length) return null;
  return Math.max(...stamps);
}

function readQuotaIpc(): UsageQuotaSnapshot | null {
  if (typeof window === "undefined") return null;
  const read = (window as unknown as { __daymarkUsageQuota?: () => unknown }).__daymarkUsageQuota;
  if (typeof read !== "function") return null;
  try {
    return normalizeQuotaSnapshot(read());
  } catch {
    return null;
  }
}

function readQuotaCache(nowMs: number): UsageQuotaSnapshot | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(USAGE_QUOTA_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = normalizeQuotaSnapshot(JSON.parse(raw));
    if (!parsed) return null;
    const updatedAtMs = quotaUpdatedAtMs(parsed);
    return { ...parsed, stale: updatedAtMs === null || nowMs - updatedAtMs > QUOTA_STALE_MS };
  } catch {
    // Corrupt cache -> behave as if absent.
    return null;
  }
}

/** Derive remaining % from the legacy usedPct contract (remaining = 100 - used). */
function quotaFromUsageSnapshot(snapshot: UsageSnapshot | null): UsageQuotaSnapshot | null {
  if (!snapshot) return null;
  const toQuota = (window: UsageWindow | null): QuotaWindow | null => {
    if (!window) return null;
    const quota: QuotaWindow = { remainingPct: clampRemainingPct(100 - window.usedPct) };
    if (typeof window.resetsAtMs === "number") quota.resetsAtMs = window.resetsAtMs;
    return quota;
  };
  const fiveHour = toQuota(snapshot.fiveHour);
  const sevenDay = toQuota(snapshot.sevenDay);
  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay, stale: false };
}

/**
 * Read the current usage quota snapshot synchronously, preferring the desktop
 * quota IPC, then the localStorage cache, then the legacy used-pct contract.
 * Returns null when nothing is derivable (meters hide).
 */
export function readUsageQuotaSnapshot(nowMs: number = Date.now()): UsageQuotaSnapshot | null {
  try {
    if (typeof localStorage !== "undefined") {
      const mock = localStorage.getItem(USAGE_MOCK_STORAGE_KEY);
      if (mock !== null && mock.trim() !== "") {
        // Mock stores used pct; reuse its deterministic shape for quota display.
        return quotaFromUsageSnapshot(parseUsageMock(mock));
      }
    }
  } catch {
    // localStorage unavailable -> fall through.
  }
  return readQuotaIpc() ?? readQuotaCache(nowMs) ?? quotaFromUsageSnapshot(readUsageSnapshot());
}
