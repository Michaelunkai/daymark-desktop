import { useEffect, useState } from "react";
import { readUsageQuotaSnapshot, type QuotaWindow, type UsageQuotaSnapshot } from "./usage-source";

/**
 * Always-visible 5h / 7d usage meters at the top of the Control Panel and the
 * workspace board. Prefers the desktop quota IPC (window.__daymarkUsageQuota,
 * REMAINING percentages + reset timestamps); falls back to the localStorage
 * quota cache and then to the legacy window.__daymarkUsage used-pct contract.
 * In a plain browser with neither source, these meters render nothing.
 */

const POLL_INTERVAL_MS = 3000;

/** Round remaining percent into 0..100 for display. */
function displayRemaining(remainingPct: number): number {
  return Math.round(Number.isFinite(remainingPct) ? Math.min(100, Math.max(0, remainingPct)) : 0);
}

function modifierFor(remaining: number): string {
  if (remaining <= 10) return " usage-meter--crit";
  if (remaining <= 25) return " usage-meter--warn";
  return "";
}

/** Compact countdown like "2h 14m" / "43m" until an epoch-ms reset. */
function resetCountdown(resetsAtMs: number | undefined, nowMs: number): string | undefined {
  if (typeof resetsAtMs !== "number") return undefined;
  const diffMin = Math.round((resetsAtMs - nowMs) / 60000);
  if (diffMin <= 0) return "resetting";
  if (diffMin < 60) return `resets in ${diffMin}m`;
  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  return minutes ? `resets in ${hours}h ${minutes}m` : `resets in ${hours}h`;
}

interface MeterEntry {
  key: string;
  caption: string;
  usage: QuotaWindow;
}

export function UsageMeters() {
  const [snapshot, setSnapshot] = useState<UsageQuotaSnapshot | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    const read = () => {
      const next = readUsageQuotaSnapshot();
      if (!cancelled) {
        setSnapshot(next ?? null);
        setNowMs(Date.now());
      }
    };

    read();
    const interval = window.setInterval(read, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (!snapshot || (!snapshot.fiveHour && !snapshot.sevenDay)) return null;

  const meters: MeterEntry[] = (
    [
      { key: "five-hour", caption: "5h", usage: snapshot.fiveHour },
      { key: "seven-day", caption: "7d", usage: snapshot.sevenDay },
    ] as const
  ).filter((meter): meter is MeterEntry => meter.usage != null);

  return (
    <div className={`usage-meters${snapshot.stale ? " usage-meters--stale" : ""}`} role="status">
      {snapshot.stale ? <span className="usage-meters__stale-flag" title="Showing a cached reading older than 30 minutes">cached</span> : null}
      {meters.map(({ key, caption, usage }) => {
        const remaining = displayRemaining(usage.remainingPct);
        const countdown = resetCountdown(usage.resetsAtMs, nowMs);
        const resetTitle =
          usage.resetsAtMs !== undefined
            ? `Resets at ${new Date(usage.resetsAtMs).toLocaleTimeString()}`
            : undefined;
        return (
          <div
            aria-label={`${caption} usage: ${remaining}% left${countdown ? `, ${countdown}` : ""}`}
            className={`usage-meter${modifierFor(remaining)}`}
            key={key}
            role="group"
            title={resetTitle}
          >
            <span className="usage-meter__caption">{caption}</span>
            <span className="usage-meter__label">
              <strong>{remaining}% left</strong>
              {countdown ? <span className="usage-meter__reset"> · {countdown}</span> : null}
            </span>
            <div className="usage-meter__bar">
              <div className="usage-meter__fill" style={{ width: `${remaining}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// SLICE-DONE: ux-designer
