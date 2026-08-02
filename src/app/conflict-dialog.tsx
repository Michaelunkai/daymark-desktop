export type ConflictDialogProps = {
  isOpen: boolean
  message: string
  onClose: () => void
  onReload: () => void
}

export function ConflictDialog({ isOpen, message, onClose, onReload }: ConflictDialogProps) {
  if (!isOpen) return null

  return (
    <div className="shell-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-modal="true" className="shell-dialog" role="dialog">
        <p className="section-kicker">SYNC CONFLICT</p>
        <h2>Review the latest workspace</h2>
        <p id="sync-conflict-message">{message}</p>
        <footer>
          <button aria-label="Keep working despite sync conflict" className="secondary-button" onClick={onClose} type="button">Keep working</button>
          <button aria-describedby="sync-conflict-message" className="primary-button" onClick={onReload} type="button">Reload latest</button>
        </footer>
      </section>
    </div>
  )
}
