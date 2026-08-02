# Deployment

## Prerequisites

- Node.js 22.12 through 24.x and npm 10 or later.
- A Vercel project connected to this repository, with the project root set to
  this directory.

Daymark has no required deployment environment variables. Copy `.env.example`
only for non-secret local configuration. Never use `VITE_` for credentials:
Vite exposes those values in browser-delivered code.

## Verify before release

```powershell
npm ci
npm run ci
npm run test:edge
npm run preview
```

`npm run test:edge` runs the secret-free Supabase Edge Function unit tests
with Deno. Install Deno 2.x locally first; the CI workflow provisions it
automatically. These tests do not connect to Supabase and do not require
project credentials.

Open the preview URL and verify a direct visit to a non-root application route
loads the app rather than a 404 page. The Vercel configuration builds `dist`,
rewrites SPA routes to `index.html`, and sends CSP, framing, content-type,
referrer, permissions, and transport-security headers.

## Vercel configuration

The repository declares the production install, build, output, headers, and
rewrite rules in `vercel.json`; no dashboard build override is required.
Deploy only after the `CI` workflow passes. The workflow performs clean
installation, linting, typechecking, unit and integration checks, clean
rebuild, high-severity dependency audit, and a history-aware secret scan.

## Rollback

1. In Vercel, open the project dashboard and select **Deployments**.
2. Select the last known-good deployment.
3. Use **Promote to Production** and confirm the promotion.
4. Verify the production URL, a direct deep link, and the response security
   headers.
5. Revert or fix the source commit in a separate pull request so future
   deployments preserve the restored state.

For a configuration-only rollback before a deploy, restore the previous
`vercel.json`, `package.json`, and lockfile together, run `npm ci` and
`npm run ci`, then deploy the verified revision.
