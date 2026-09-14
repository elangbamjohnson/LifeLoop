# DEVELOPMENT.md

## Running Locally

### Prerequisites
- Node.js (v20+)
- PostgreSQL (v15+)

### Setup
1. Clone the repository.
2. Run `npm install` to grab dependencies.
3. Copy `.env.example` to `.env` and fill in local database credentials and secrets.

### Database Setup
1. Ensure your local PostgreSQL is running and you have created a database.
2. Run `npx drizzle-kit push` to push the schema from `/src/db/schema.ts` to your local instance.

### Development Server
Run `npm run dev`. This will start:
- Vite dev server for the frontend (handling HMR).
- Express backend running via `tsx` on port 3000.

### Testing
- Run `npm test` to execute Vitest suites.
- Tests are co-located with their features or placed in dedicated `__tests__` folders.

### Migrations
When `src/db/schema.ts` changes:
1. `npx drizzle-kit generate` - Generates SQL migration files in `/src/db/migrations`.
2. `npx drizzle-kit push` or configure a migration script to apply changes.
