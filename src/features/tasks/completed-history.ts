export type CompletedHistoryItem = {
  id: string
  completedAt: string | null | undefined
}

export function sortCompletedHistoryNewestFirst<T extends CompletedHistoryItem>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => (
    (right.completedAt ?? '').localeCompare(left.completedAt ?? '')
    || right.id.localeCompare(left.id)
  ))
}
