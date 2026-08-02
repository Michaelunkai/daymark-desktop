export type SyncStatusProps = {
  isOnline: boolean
  pendingCount: number
  onSync: () => void
  syncError?: string
}

export function SyncStatus({ isOnline, pendingCount, onSync, syncError }: SyncStatusProps) {
  const label = syncError
    ? "Sync needs attention"
    : pendingCount
      ? `${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting`
      : isOnline
        ? "All changes saved"
        : "Working offline"

  return (
    <button
      aria-label="Sync status"
      className={`sync-status ${syncError ? "sync-status--error" : ""}`}
      onClick={onSync}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className="sync-status__dot" />
      <span>{label}</span>
    </button>
  )
}
