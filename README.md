# LifeLoop

A personal life-management app: capture thoughts, AI-classifies them into actionable items, reminders, and waiting-for items.

---

## Prerequisites

- **Node.js** >= 20
- **PostgreSQL** running locally on `127.0.0.1:5433` (for tests)
- A **Neon** (or compatible Postgres) database for development/production

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```env
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
JWT_SECRET="your-secret-here"
GEMINI_API_KEY="your-gemini-api-key"
PORT=64532
# HOST=127.0.0.1   (see HOST section below)
```

### HOST — Bind Address

| Value       | When to use |
| :---------- | :--- |
| (unset)     | Default for dev/test. Binds to 127.0.0.1 (loopback). Only the local machine can reach it. |
| 127.0.0.1   | Explicit loopback. Same as unset for dev/test. |
| 0.0.0.0     | All interfaces. Used automatically in production (Cloud Run, Render, etc.). |

WARNING: Never set HOST=0.0.0.0 locally unless you intentionally want the server
reachable from other devices on your network. Do not commit HOST=0.0.0.0 to .env.

Both server.ts (Express) and vite.config.ts (Vite dev server + HMR socket) read HOST:

  // server.ts
  const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  const server = app.listen(PORT, host, () => { ... });

  // vite.config.ts
  const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  server: { host, hmr: { host, port: hmrPort } }

---

## Development

  npm install
  npm run dev          # starts on http://127.0.0.1:64532 by default
  npm run check        # runs TypeScript typechecking

---

## Testing

### Unit / Integration (Vitest)

Requires local Postgres on 127.0.0.1:5433 with database lifeloop_test_db.

  pg_isready -h 127.0.0.1 -p 5433
  npx vitest run
  npx vitest run --sequence.seed=12345

Tests load .env.test only and never touch the Neon/production database.

### E2E (Playwright)

Playwright manages its own server lifecycle — starts before the run, stops after (even on failure).

  npx playwright test
  npx playwright test --project=mobile-webkit

The e2e server runs on a dedicated port to prevent conflicts with the dev server:

  Server                  PORT    HMR Port
  Dev (npm run dev)       64532   24678
  E2E (playwright test)   64533   24679

After a run both ports must be free:
  lsof -nP -iTCP:64533 -iTCP:24679 -sTCP:LISTEN   # must be empty

---

## Production

NODE_ENV=production is required. The server refuses to start if:
- AI_PROVIDER=mock
- DISABLE_RATE_LIMIT=1
- GEMINI_API_KEY is missing

HOST defaults to 0.0.0.0 in production so the load balancer can reach it.

---

## Port Layout

  Context         PORT          HMR Port   HOST default
  Dev             64532         24678      127.0.0.1
  E2E             64533         24679      127.0.0.1
  Production      $PORT/3000    N/A        0.0.0.0

---

## Admin Roles & Privileges

Certain advanced capabilities (such as the Ask AI assistant and the Knowledge Graph explorer) are restricted to administrator users.

- The `users` table contains an `is_admin` boolean column defaulting to `false`.
- No API endpoint allows setting or updating the `is_admin` flag. Registration and profile updates strictly ignore any `isAdmin` fields in the payload.
- To grant admin privileges to a user, execute the SQL script in `docs/grant-admin.sql` directly against the database:
  1. Add the column (if not already applied):
     ```sql
     ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
     ```
  2. Promote a target user by email:
     ```sql
     UPDATE users SET is_admin = true WHERE email = 'user@example.com';
     ```

