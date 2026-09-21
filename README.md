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

## Environments

### Development (local)

The local dev server connects to a **local PostgreSQL instance only**. It will
refuse to start if `DATABASE_URL` points to any non-loopback host that is not
explicitly listed in `DEV_DB_ALLOWED_HOSTS`. `PROD_DB_HOST` adds a second line
of defence: even an allowlisted host is rejected if it matches the production
host.

#### 1. Create the local dev database

```bash
# Adjust -h / -p / -U if your local Postgres differs.
createdb -h 127.0.0.1 -p 5433 -U postgres lifeloop_dev_db
```

#### 2. Configure `.env`

Copy `.env.example` to `.env` and set:

```env
DATABASE_URL=postgres://postgres@127.0.0.1:5433/lifeloop_dev_db
PROD_DB_HOST=<your-production-db-host-only>   # no credentials
DEV_DB_ALLOWED_HOSTS=                         # leave blank for loopback-only
```

#### 3. Apply schema

```bash
npm run db:migrate:dev
```

#### 4. Register a dev account

Start the server (`npm run dev`), open http://localhost:64532, and register
through the UI. No seed script is needed.

#### 5. Grant admin privileges (local only)

Run this SQL directly against your **local** `lifeloop_dev_db`:

```sql
UPDATE public.users SET is_admin = true WHERE email = 'you@example.com';
```

Production variables are configured in the **Render dashboard** only.
Never point your local `.env` at the production database.

---

## Development

  npm install
  npm run dev          # starts on http://127.0.0.1:64532 by default
  npm run check        # runs TypeScript typechecking
  npm run db:migrate:dev  # applies schema to local dev database

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

