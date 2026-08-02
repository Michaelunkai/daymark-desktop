import { createHash } from "node:crypto"
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"

import { createAppShellServiceWorkerSource } from "./src/pwa/register-service-worker.ts"

const manifestPath = "/manifest.webmanifest"
const iconPaths = ["/icons/daymark-192.png", "/icons/daymark-512.png"]

function daymarkPwa(): Plugin {
  return {
    name: "daymark-pwa",
    transformIndexHtml() {
      return {
        tags: [
        {
          tag: "link",
          attrs: { rel: "manifest", href: manifestPath },
          injectTo: "head",
        },
        {
          tag: "script",
          attrs: { type: "module", src: "/src/pwa/register-service-worker.ts" },
          injectTo: "body",
        },
        ],
      }
    },
    generateBundle(_, bundle) {
      const appShellUrls = [
        "/",
        "/index.html",
        manifestPath,
        ...iconPaths,
        ...Object.keys(bundle)
          .filter((fileName) => fileName !== "service-worker.js")
          .map((fileName) => `/${fileName}`),
      ]
      const cacheName = `daymark-shell-${createHash("sha256")
        .update(appShellUrls.join("\n"))
        .digest("hex")
        .slice(0, 12)}`

      this.emitFile({
        type: "asset",
        fileName: "service-worker.js",
        source: createAppShellServiceWorkerSource({ cacheName, appShellUrls }),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), daymarkPwa()],
  server: {
    host: "127.0.0.1",
  },
})
