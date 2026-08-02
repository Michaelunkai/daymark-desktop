import { useEffect, useState, useSyncExternalStore } from "react"

import type { AppState } from "../core/types"
import { IndexedDbWorkspaceStorage } from "../core/offline"
import type { DaymarkRepository } from "../core/repository"

export function useDaymarkApp(repository: DaymarkRepository, workspaceId = "local") {
  const state = useSyncExternalStore(repository.subscribe, repository.getState, repository.getState)
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine)
  const [offlineError, setOfflineError] = useState("")

  useEffect(() => {
    const storage = new IndexedDbWorkspaceStorage()
    if (!storage.isAvailable) return

    const persist = (nextState: AppState) => {
      void storage.saveSnapshot(workspaceId, nextState).catch(() => {
        setOfflineError("Local offline storage could not be updated.")
      })
    }
    persist(repository.getState())
    return repository.subscribe(persist)
  }, [repository, workspaceId])

  useEffect(() => {
    const updateConnectivity = () => setIsOnline(navigator.onLine)
    window.addEventListener("online", updateConnectivity)
    window.addEventListener("offline", updateConnectivity)
    return () => {
      window.removeEventListener("online", updateConnectivity)
      window.removeEventListener("offline", updateConnectivity)
    }
  }, [])

  return { isOnline, offlineError, state }
}
