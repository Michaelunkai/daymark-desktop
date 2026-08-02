export type InstallPromptChoice = {
  outcome: "accepted" | "dismissed"
  platform?: string
}

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallPromptChoice>
}

export type InstallPromptState = {
  available: boolean
  dismissed: boolean
  installed: boolean
}

type Listener = () => void

const initialState: InstallPromptState = {
  available: false,
  dismissed: false,
  installed: false,
}

export function createInstallPromptController(target?: EventTarget) {
  let deferredPrompt: InstallPromptEvent | null = null
  let state = initialState
  const listeners = new Set<Listener>()

  const notify = () => listeners.forEach((listener) => listener())
  const setState = (patch: Partial<InstallPromptState>) => {
    state = { ...state, ...patch }
    notify()
  }
  const onBeforeInstallPrompt = (event: Event) => {
    const installEvent = event as InstallPromptEvent
    installEvent.preventDefault()
    deferredPrompt = installEvent
    setState({ available: true, dismissed: false })
  }
  const onAppInstalled = () => {
    deferredPrompt = null
    setState({ available: false, dismissed: false, installed: true })
  }

  return {
    start() {
      target?.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
      target?.addEventListener("appinstalled", onAppInstalled)
    },
    stop() {
      target?.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt)
      target?.removeEventListener("appinstalled", onAppInstalled)
    },
    getState: () => state,
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dismiss() {
      deferredPrompt = null
      setState({ available: false, dismissed: true })
    },
    async prompt() {
      if (!deferredPrompt) return null

      const prompt = deferredPrompt
      await prompt.prompt()
      const choice = await prompt.userChoice
      deferredPrompt = null
      setState({
        available: false,
        dismissed: choice.outcome !== "accepted",
        installed: choice.outcome === "accepted",
      })
      return choice
    },
  }
}
