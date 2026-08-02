import { createInstallPromptController } from "./install-prompt.ts"

export const APP_SHELL_CACHE_PREFIX = "daymark-shell-"

export type ServiceWorkerUpdateState = {
  available: boolean
  registration: ServiceWorkerRegistration | null
}

export type AppShellWorkerOptions = {
  cacheName: string
  appShellUrls: string[]
}

type Listener = () => void

export function isNetworkOnlyRequest(
  request: Pick<Request, "method" | "url" | "headers">,
  origin = typeof location === "undefined" ? "http://localhost" : location.origin,
) {
  const url = new URL(request.url, origin)
  const isApiOrAuthRoute = /(^|\/)(api|auth|graphql)(\/|$)/i.test(url.pathname)

  return (
    request.method !== "GET" ||
    url.origin !== origin ||
    isApiOrAuthRoute ||
    request.headers.has("authorization")
  )
}

export function createAppShellServiceWorkerSource({ cacheName, appShellUrls }: AppShellWorkerOptions) {
  return `const CACHE_NAME = ${JSON.stringify(cacheName)};
const APP_SHELL_URLS = ${JSON.stringify([...new Set(appShellUrls)])};
const NETWORK_ONLY_ROUTE = /(^|\\/)(api|auth|graphql)(\\/|$)/i;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("${APP_SHELL_CACHE_PREFIX}") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const networkOnly =
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    NETWORK_ONLY_ROUTE.test(url.pathname) ||
    request.headers.has("authorization");

  if (networkOnly) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/").then((response) => response || caches.match("/index.html"))),
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});`
}

export function createServiceWorkerUpdateController() {
  let state: ServiceWorkerUpdateState = { available: false, registration: null }
  const listeners = new Set<Listener>()
  const notify = () => listeners.forEach((listener) => listener())

  return {
    getState: () => state,
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setRegistration(registration: ServiceWorkerRegistration) {
      state = { ...state, registration, available: Boolean(registration.waiting) }
      notify()
    },
    markAvailable(registration: ServiceWorkerRegistration) {
      state = { available: true, registration }
      notify()
    },
    apply() {
      state.registration?.waiting?.postMessage({ type: "SKIP_WAITING" })
    },
  }
}

export const installPrompt = createInstallPromptController(
  typeof window === "undefined" ? undefined : window,
)
export const serviceWorkerUpdate = createServiceWorkerUpdateController()

export async function registerServiceWorker(
  serviceWorkerContainer =
    typeof navigator === "undefined" ? undefined : navigator.serviceWorker,
) {
  if (!serviceWorkerContainer) return null

  const registration = await serviceWorkerContainer.register("/service-worker.js", { scope: "/" })
  serviceWorkerUpdate.setRegistration(registration)

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing
    if (!installing) return

    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && serviceWorkerContainer.controller) {
        serviceWorkerUpdate.markAvailable(registration)
      }
    })
  })

  return registration
}

if (typeof window !== "undefined") {
  installPrompt.start()
  void registerServiceWorker()
}
