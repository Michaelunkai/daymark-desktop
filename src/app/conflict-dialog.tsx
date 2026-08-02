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
        <p>{message}</p>
        <footer>
          <button className="secondary-button" onClick={onClose} type="button">Keep working</button>
          <button className="primary-button" onClick={onReload} type="button">Reload latest</button>
        </footer>
      </section>
    </div>
  )
}
