import { access, cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

async function exists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

// Sites runs the emitted Worker and binds the built static files as ASSETS.
// Keep the Worker source checked in and copy it only after Vite has emitted the
// application assets so every production archive has a real runtime entrypoint.
export function sites() {
  let root = process.cwd()

  return {
    name: 'sites',
    apply: 'build',
    configResolved(config) {
      root = config.root
    },
    async closeBundle() {
      const outputDirectory = resolve(root, 'dist', '.openai')
      const legacyIndex = resolve(root, 'dist', 'index.html')
      const legacyAssets = resolve(root, 'dist', 'assets')
      const hostingConfig = resolve(root, '.openai', 'hosting.json')
      const drizzleSource = resolve(root, 'drizzle')
      const workerSource = resolve(root, 'worker', 'index.js')
      const workerOutput = resolve(root, 'dist', 'server', 'index.js')

      if (!(await exists(workerSource))) {
        throw new Error(`Missing Sites Worker source: ${workerSource}`)
      }

      // Remove the previous plain-Vite layout so archives cannot contain
      // ambiguous root-level client files alongside dist/client.
      await rm(legacyIndex, { force: true })
      await rm(legacyAssets, { recursive: true, force: true })
      await mkdir(resolve(root, 'dist', 'server'), { recursive: true })
      await cp(workerSource, workerOutput)

      await rm(outputDirectory, { recursive: true, force: true })
      await mkdir(outputDirectory, { recursive: true })

      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, 'hosting.json'))
      }
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, 'drizzle'), {
          recursive: true,
        })
      }
    },
  }
}
