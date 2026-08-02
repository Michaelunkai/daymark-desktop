import assert from "node:assert/strict"
import test from "node:test"

import { createInstallPromptController } from "./install-prompt.ts"
import {
  APP_SHELL_CACHE_PREFIX,
  createAppShellServiceWorkerSource,
  createServiceWorkerUpdateController,
  isNetworkOnlyRequest,
} from "./register-service-worker.ts"

test("keeps mutation, API, auth, GraphQL, cross-origin, and authenticated traffic network-only", () => {
  const request = (url: string, method = "GET", authorization?: string) => ({
    url,
    method,
    headers: new Headers(authorization ? { authorization } : undefined),
  })

  assert.equal(isNetworkOnlyRequest(request("https://daymark.test/tasks", "POST"), "https://daymark.test"), true)
  assert.equal(isNetworkOnlyRequest(request("https://daymark.test/api/tasks"), "https://daymark.test"), true)
  assert.equal(isNetworkOnlyRequest(request("https://daymark.test/auth/session"), "https://daymark.test"), true)
  assert.equal(isNetworkOnlyRequest(request("https://daymark.test/graphql"), "https://daymark.test"), true)
  assert.equal(isNetworkOnlyRequest(request("https://remote.test/app.js"), "https://daymark.test"), true)
  assert.equal(isNetworkOnlyRequest(request("https://daymark.test/tasks", "GET", "Bearer token"), "https://daymark.test"), true)
  assert.equal(isNetworkOnlyRequest(request("https://daymark.test/assets/app.js"), "https://daymark.test"), false)
})

test("emits a precached navigation fallback without runtime API caching", () => {
  const source = createAppShellServiceWorkerSource({
    cacheName: "daymark-shell-test",
    appShellUrls: ["/", "/index.html", "/assets/app.js"],
  })

  assert.match(source, /cache\.addAll\(APP_SHELL_URLS\)/)
  assert.match(source, /request\.mode === "navigate"/)
  assert.match(source, /caches\.match\("\/"\)/)
  assert.match(source, /NETWORK_ONLY_ROUTE/)
  assert.match(source, /event\.data\.type === "SKIP_WAITING"/)
  assert.doesNotMatch(source, /then\(\(\) => self\.skipWaiting\(\)\)/)
  assert.doesNotMatch(source, /cache\.put/)
  assert.match(source, new RegExp(APP_SHELL_CACHE_PREFIX))
})

test("exposes install prompt lifecycle and an update activation action", async () => {
  const target = new EventTarget()
  const install = createInstallPromptController(target)
  let observed = 0
  install.subscribe(() => observed++)
  install.start()

  let prompted = false
  const promptEvent = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" }>
  }
  promptEvent.prompt = async () => {
    prompted = true
  }
  promptEvent.userChoice = Promise.resolve({ outcome: "accepted" })
  target.dispatchEvent(promptEvent)

  assert.equal(install.getState().available, true)
  assert.deepEqual(await install.prompt(), { outcome: "accepted" })
  assert.equal(prompted, true)
  assert.equal(install.getState().installed, true)
  assert.ok(observed >= 2)

  const update = createServiceWorkerUpdateController()
  let message: unknown
  update.setRegistration({ waiting: { postMessage: (value: unknown) => (message = value) } } as ServiceWorkerRegistration)
  update.apply()
  assert.deepEqual(message, { type: "SKIP_WAITING" })
})
