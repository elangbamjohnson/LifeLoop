/**
 * src/db/config.ts
 *
 * The ONE place that reads DATABASE_URL / TEST_DATABASE_URL from the environment
 * and enforces environment-specific connection rules. All other modules that open a
 * database connection MUST import getConnectionString() from here and MUST NOT read
 * process.env.DATABASE_URL directly.
 *
 * Rules:
 *   NODE_ENV=production  – DATABASE_URL required; no host restriction.
 *   NODE_ENV=test        – TEST_DATABASE_URL required; host must be loopback or
 *                          ALLOW_REMOTE_TEST_DB=1 set; cannot equal DATABASE_URL host+db.
 *   otherwise (dev)      – DATABASE_URL required; host must be a loopback address
 *                          (127.0.0.1 | localhost | ::1) OR listed in
 *                          DEV_DB_ALLOWED_HOSTS (comma-separated, stripped of "-pooler",
 *                          lowercased). If PROD_DB_HOST is set and matches the resolved
 *                          host, refuse even when allowlisted. No override flag.
 *
 * Error messages NEVER contain the URL, username, or password.
 */

export type DbEnv = "production" | "test" | "development";

/** Strips "-pooler" and brackets, and lowercases a hostname for canonical comparison. */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, "").replace(/-pooler(?=\.|$)/g, "");
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(normalizeHost(host));
}

/**
 * Returns the validated, normalised connection string for the current environment.
 * Throws a descriptive—but credential-free—Error if any guard is violated.
 *
 * @param env  The process.env record (or a subset thereof for unit testing).
 */
export function getConnectionString(env: Record<string, string | undefined> = process.env): string {
  const nodeEnv = env.NODE_ENV ?? "development";

  if (nodeEnv === "test") {
    return _resolveTest(env);
  }

  if (nodeEnv === "production") {
    return _resolveProduction(env);
  }

  // Everything else is treated as development.
  return _resolveDevelopment(env);
}

// ─── Production ──────────────────────────────────────────────────────────────

function _resolveProduction(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "[DB CONFIG] FATAL: DATABASE_URL is required in production. " +
      "Set it in your hosting provider's environment variables (e.g. Render settings)."
    );
  }
  return url;
}

// ─── Test ─────────────────────────────────────────────────────────────────────

function _resolveTest(env: Record<string, string | undefined>): string {
  const testUrl = env.TEST_DATABASE_URL;
  if (!testUrl || testUrl.trim() === "") {
    throw new Error(
      "[DB CONFIG] FATAL: TEST_DATABASE_URL is required for tests. No fallback to DATABASE_URL allowed."
    );
  }

  const parsed = new URL(testUrl);
  const testHost = parsed.hostname;

  if (!isLoopback(testHost) && env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(
      `[DB CONFIG] FATAL: TEST_DATABASE_URL host '${testHost}' is not a loopback address. ` +
      "Set ALLOW_REMOTE_TEST_DB=1 to allow remote test databases."
    );
  }

  // Guard against test DB accidentally pointing at the same database as DATABASE_URL.
  const prodUrl = env.DATABASE_URL;
  if (prodUrl && prodUrl.trim() !== "") {
    try {
      const prodParsed = new URL(prodUrl);
      if (
        normalizeHost(testHost) === normalizeHost(prodParsed.hostname) &&
        parsed.pathname === prodParsed.pathname
      ) {
        throw new Error(
          "[DB CONFIG] FATAL: TEST_DATABASE_URL cannot point to the same host and database as DATABASE_URL."
        );
      }
    } catch (err: any) {
      // Re-throw our own guard errors; ignore URL parse errors from DATABASE_URL.
      if (err.message.startsWith("[DB CONFIG]")) throw err;
    }
  }

  return testUrl;
}

// ─── Development ─────────────────────────────────────────────────────────────

function _resolveDevelopment(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "[DB CONFIG] FATAL: DATABASE_URL is required for local development. " +
      "Set it in your .env file to a local PostgreSQL database " +
      "(e.g. postgres://postgres@127.0.0.1:5433/lifeloop_dev_db). " +
      "Never point local development at the production database."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "[DB CONFIG] FATAL: DATABASE_URL is not a valid URL. " +
      "Check your .env file. The value must be a valid postgres:// connection string."
    );
  }

  const rawHost = parsed.hostname;
  const normalizedHost = normalizeHost(rawHost);

  // Build the set of explicitly allowed remote hosts from DEV_DB_ALLOWED_HOSTS.
  const allowedHostsRaw = env.DEV_DB_ALLOWED_HOSTS ?? "";
  const allowedHosts = allowedHostsRaw
    .split(",")
    .map((h) => normalizeHost(h.trim()))
    .filter((h) => h.length > 0);

  // If PROD_DB_HOST is set, reject any attempt to use that host — even if allowlisted.
  if (env.PROD_DB_HOST) {
    const normalizedProdHost = normalizeHost(env.PROD_DB_HOST.trim());
    if (normalizedProdHost && normalizedHost === normalizedProdHost) {
      throw new Error(
        "[DB CONFIG] FATAL: DATABASE_URL resolves to the production database host. " +
        "Local development must never connect to the production database. " +
        "Update DATABASE_URL in .env to a local PostgreSQL instance " +
        "(e.g. postgres://postgres@127.0.0.1:5433/lifeloop_dev_db)."
      );
    }
  }

  const isAllowed = isLoopback(rawHost) || allowedHosts.includes(normalizedHost);
  if (!isAllowed) {
    throw new Error(
      "[DB CONFIG] FATAL: DATABASE_URL points to a non-loopback host which is not in DEV_DB_ALLOWED_HOSTS. " +
      "Local development must use a local database " +
      "(e.g. postgres://postgres@127.0.0.1:5433/lifeloop_dev_db). " +
      "If you intentionally need a remote dev database, add the hostname (without credentials) " +
      "to DEV_DB_ALLOWED_HOSTS in your .env file."
    );
  }

  return url;
}

/**
 * Emits a one-time startup log line with environment and connection info but WITHOUT
 * credentials. Call once from server entry-point after the connection string is resolved.
 *
 * Format: env=<NODE_ENV> db=<host>:<port>/<dbname>
 */
export function logDbStartup(
  connectionString: string,
  env: Record<string, string | undefined> = process.env
): void {
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname;
    const port = parsed.port || "5432";
    const dbname = parsed.pathname.replace(/^\//, "");
    const nodeEnv = env.NODE_ENV ?? "development";
    console.log(`env=${nodeEnv} db=${host}:${port}/${dbname}`);
  } catch {
    // If parsing fails, emit a safe fallback without any URL content.
    console.log(`env=${env.NODE_ENV ?? "development"} db=<unknown>`);
  }
}
