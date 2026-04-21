# Team Procurement Dashboard

A Fusion-backed procurement manager dashboard. Ships with mock data so it runs
standalone — swap `src/lib/fusion-service.ts` for real BFF calls when ready.

See `INTEGRATION.md` for the Fusion connection plan.

## Run locally

```bash
npm install
npm run dev
```

Opens on http://localhost:5173.

## Build

```bash
npm run build
npm run preview
```

## Deploy to Vercel

1. Push this folder to a GitHub repo (public or private).
2. Go to vercel.com → New Project → Import the repo.
3. Vercel auto-detects Vite. Leave defaults. Click Deploy.
4. You get a URL like `team-procurement-dashboard-xxx.vercel.app` — share
   that with colleagues.

Subsequent pushes to `main` redeploy automatically.

## Project layout

```
src/
  main.tsx                           React entry
  preview.tsx                        Dashboard component (the UI)
  lib/
    fusion-types.ts                  Fusion REST shapes
    fusion-utils.ts                  Pure helpers
    fusion-service.ts                THE SWAP POINT (mock -> BFF)
    cn.ts                            Tailwind class merger
  hooks/
    use-live-requisitions.ts         Polling + diff + flash (SSE swap later)
  components/ui/
    card.tsx                         shadcn-style primitive
    button.tsx                       shadcn-style primitive
```
