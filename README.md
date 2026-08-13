# Vaišė

**Vaišė** is a QR-based in-restaurant ordering platform — menu browsing, an AI waiter assistant, cart and table sessions, live kitchen and waiter displays, bill splitting, and an owner admin dashboard. A separate installable staff app (`/app`) covers waiter, kitchen and admin roles.

The bundled demo restaurant is **Dzūkų Ainiai** (Dzūkų Alaus Restoranas, Vilniaus g. 35, Alytus). Its name, menu, and contact details are demo content served through Vaišė — the platform itself is Vaišė.

Built with [Next.js](https://nextjs.org) 16 (App Router, TypeScript, Tailwind v4).

## Requirements

- **Node.js ≥ 23.4** — required for `node:sqlite`, used by local dev sync storage. Older Node versions will fail with an unclear error.
- Works the same on **macOS and Windows**. On Windows, use PowerShell or a terminal that isn't legacy `cmd.exe` for best compatibility with npm scripts.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the guest menu, or [http://localhost:3000/app](http://localhost:3000/app) for the staff hub (waiter / kitchen / admin).

Local dev uses a SQLite file at `data/vaise.db` (auto-created, gitignored) for cross-device order sync. Production (Vercel) uses Postgres instead — see `.env.local.example` for the environment variables that switch between them.

## Staff accounts

`/admin`, `/waiter`, `/kitchen` and `/app` all require a login. Waiter and kitchen accounts are created from the admin panel; the Admin account itself is bootstrapped once, by us, from the command line:

```bash
node --experimental-strip-types scripts/create-staff-account.mjs <username> <password> admin
```

Run it locally (writes to `data/vaise.db`) or with the production `DATABASE_URL` set (writes to Postgres). Set `STAFF_AUTH_SECRET` in `.env.local` / Vercel env vars — see `.env.local.example`.

## Tests

```bash
npm test              # core suites: assistant, sync, split-bill
npm run test:phase2a  # AI waiter foundation
npm run test:phase2b1 # AI waiter turn controller + corrective flow
npm run test:phase2b2 # AI waiter live UI
```

## Deploy

Deployed on [Vercel](https://vercel.com). Push to `main` and Vercel builds and deploys automatically; Postgres (Neon) is provisioned through Vercel Storage and its env vars are auto-injected.
