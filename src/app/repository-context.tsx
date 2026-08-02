import { createContext, useContext, type PropsWithChildren } from "react"

import type { DaymarkRepository } from "../core/repository"

const RepositoryContext = createContext<DaymarkRepository | null>(null)

export function RepositoryProvider({
  children,
  repository,
}: PropsWithChildren<{ repository: DaymarkRepository }>) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>
}

export function useRepository(): DaymarkRepository {
  const repository = useContext(RepositoryContext)
  if (!repository) throw new Error("useRepository must be used inside RepositoryProvider.")
  return repository
}
