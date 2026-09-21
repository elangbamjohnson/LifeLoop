import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { getConnectionString } from "./config";

// getConnectionString() enforces the dev-DB guard: refuses to start if
// DATABASE_URL points to a non-loopback host that is not allowlisted, or if
// it matches PROD_DB_HOST. drizzle-kit migrations therefore can never run
// against the production database from a local machine.
const connectionString = getConnectionString();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
