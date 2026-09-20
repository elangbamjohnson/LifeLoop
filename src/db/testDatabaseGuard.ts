/**
 * Test Database Safety Guard
 * Aborts test execution unless NODE_ENV === 'test' and the database configuration
 * safely isolates test data from production or development environments.
 */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace("-pooler", "");
}

export function assertTestDatabaseGuard(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV !== "test") {
    throw new Error(
      `[DATABASE SAFETY GUARD] Aborting: NODE_ENV must be 'test', but was '${env.NODE_ENV ?? ""}'. Refusing to run tests against non-test environment.`
    );
  }

  const testDbUrl = env.TEST_DATABASE_URL;
  const dbUrl = env.DATABASE_URL;

  if (!testDbUrl || testDbUrl.trim().length === 0) {
    throw new Error(
      "[DATABASE SAFETY GUARD] Aborting: TEST_DATABASE_URL is required for tests. No fallback allowed."
    );
  }

  const testUrl = new URL(testDbUrl);
  const isLoopback = testUrl.hostname === '127.0.0.1' || testUrl.hostname === 'localhost' || testUrl.hostname === '::1';

  if (!isLoopback && env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(
      `[DATABASE SAFETY GUARD] Aborting: TEST_DATABASE_URL host '${testUrl.hostname}' is not a loopback address, and ALLOW_REMOTE_TEST_DB=1 is not set.`
    );
  }

  if (dbUrl) {
    const prodUrl = new URL(dbUrl);
    if (normalizeHost(testUrl.hostname) === normalizeHost(prodUrl.hostname) && testUrl.pathname === prodUrl.pathname) {
      throw new Error("[DATABASE SAFETY GUARD] Aborting: TEST_DATABASE_URL cannot point to the same host and database as DATABASE_URL.");
    }
  }
}

/**
 * Executes a live PostgreSQL query to verify that current_schema() and search_path
 * strictly resolve to the expected test schema, aborting immediately if they resolve elsewhere.
 */
export async function assertTestDatabaseLiveGuard(
  sqlInstance: any,
  expectedSchema: string = process.env.TEST_SCHEMA || "lifeloop_test"
): Promise<{ currentSchema: string; searchPath: string }> {
  const rows = await sqlInstance`SELECT current_database() as cd, current_schema() as cs, current_setting('search_path') as sp;`;
  const currentDb = rows[0]?.cd;
  const currentSchema = rows[0]?.cs;
  const searchPath = rows[0]?.sp;

  const expectedDb = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
  if (currentDb !== expectedDb) {
    throw new Error(
      `[DATABASE SAFETY GUARD] Aborting: current_database() resolved to '${currentDb}', but expected '${expectedDb}'.`
    );
  }

  if (currentSchema !== expectedSchema) {
    throw new Error(
      `[DATABASE SAFETY GUARD] Aborting: current_schema() resolved to '${currentSchema}', but expected test schema '${expectedSchema}'. Refusing to proceed.`
    );
  }

  if (!searchPath || !searchPath.includes(expectedSchema)) {
    throw new Error(
      `[DATABASE SAFETY GUARD] Aborting: search_path '${searchPath}' does not contain test schema '${expectedSchema}'.`
    );
  }

  return { currentSchema, searchPath };
}

