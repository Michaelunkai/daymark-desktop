# Daymark Desktop

Daymark is a local, desktop-oriented task manager built with React and Vite.
It stores task state in the browser and provides focused task capture,
navigation, scheduling, reminders, search, and keyboard-driven workflows.

## Local setup

```powershell
npm ci
npm run env:check
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/` in a desktop browser.

Copy `.env.example` to `.env` only when local, non-secret configuration is
needed. `VITE_` variables are bundled into the client and must never contain
credentials.

## Commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run rebuild
npm run verify
npm run ci
npm run preview
```

`rebuild` deletes and regenerates `dist`. `verify` performs environment,
lint, type, test, and clean-rebuild checks; `ci` also runs the dependency
audit.

## Deployment

Vercel uses `npm ci`, `npm run build`, and serves `dist`. The included
`vercel.json` provides SPA deep-link routing and browser security headers.
See [deployment instructions](docs/deployment.md) for verification and exact
rollback steps.

## Included behavior

- Inbox, Today, Upcoming, project, and label views
- Task creation, completion, priority, local persistence, and reminders
- Natural-language due-date parsing and recurring scheduling helpers
- Search, command palette, and keyboard navigation
- List and board task layouts with a desktop-oriented interface
