/**
 * tests/db_config.test.ts
 *
 * Pure-function unit tests for src/db/config.ts.
 * No database connection is ever opened.
 * Fake passwords like SECRET123 must never appear in any error message or log.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { getConnectionString, normalizeHost, logDbStartup } from "../src/db/config";

// ─── normalizeHost ─────────────────────────────────────────────────────────────

describe("normalizeHost", () => {
  it("strips -pooler suffix", () => {
    expect(normalizeHost("ep-foo-pooler")).toBe("ep-foo");
  });

  it("lowercases the host", () => {
    expect(normalizeHost("EP-FOO")).toBe("ep-foo");
  });

  it("strips -pooler and lowercases together", () => {
    expect(normalizeHost("EP-AUTUMN-FIREFLY-POOLER")).toBe("ep-autumn-firefly");
  });

  it("leaves loopback addresses unchanged", () => {
    expect(normalizeHost("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeHost("localhost")).toBe("localhost");
    expect(normalizeHost("::1")).toBe("::1");
  });
});

// ─── development ──────────────────────────────────────────────────────────────

describe("getConnectionString — development", () => {
  it("starts when DATABASE_URL points to 127.0.0.1 (loopback)", () => {
    expect(() =>
      getConnectionString({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://postgres:SECRET123@127.0.0.1:5433/lifeloop_dev_db",
      })
    ).not.toThrow();
  });

  it("starts when DATABASE_URL points to localhost", () => {
    expect(() =>
      getConnectionString({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://postgres:SECRET123@localhost:5433/lifeloop_dev_db",
      })
    ).not.toThrow();
  });

  it("starts when DATABASE_URL points to [::1] (IPv6 loopback)", () => {
    expect(() =>
      getConnectionString({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://postgres:SECRET123@[::1]:5433/lifeloop_dev_db",
      })
    ).not.toThrow();
  });

  it("refuses when DATABASE_URL points to a remote host not in DEV_DB_ALLOWED_HOSTS", () => {
    const err = (() => {
      try {
        getConnectionString({
          NODE_ENV: "development",
          DATABASE_URL: "postgres://postgres:SECRET123@remotedb.example.com:5432/db",
          DEV_DB_ALLOWED_HOSTS: "",
        });
      } catch (e: any) {
        return e;
      }
    })();
    expect(err).toBeDefined();
    expect(err.message).toMatch(/non-loopback host/i);
    // Secret must never appear in the error message.
    expect(err.message).not.toContain("SECRET123");
  });

  it("starts when DATABASE_URL host is listed in DEV_DB_ALLOWED_HOSTS", () => {
    expect(() =>
      getConnectionString({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://postgres:SECRET123@staging.example.com:5432/db",
        DEV_DB_ALLOWED_HOSTS: "staging.example.com",
      })
    ).not.toThrow();
  });

  it("allowlist comparison is case-insensitive and strips -pooler", () => {
    expect(() =>
      getConnectionString({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://postgres:SECRET123@staging.example.com:5432/db",
        DEV_DB_ALLOWED_HOSTS: "STAGING.EXAMPLE.COM-POOLER",
      })
    ).not.toThrow();
  });

  it("refuses when DATABASE_URL host matches PROD_DB_HOST even if allowlisted", () => {
    const err = (() => {
      try {
        getConnectionString({
          NODE_ENV: "development",
          DATABASE_URL: "postgres://postgres:SECRET123@ep-prod.neon.tech:5432/db",
          DEV_DB_ALLOWED_HOSTS: "ep-prod.neon.tech",
          PROD_DB_HOST: "ep-prod.neon.tech",
        });
      } catch (e: any) {
        return e;
      }
    })();
    expect(err).toBeDefined();
    expect(err.message).toMatch(/production database host/i);
    expect(err.message).not.toContain("SECRET123");
  });

  it("PROD_DB_HOST comparison normalises -pooler and is case-insensitive", () => {
    const err = (() => {
      try {
        getConnectionString({
          NODE_ENV: "development",
          DATABASE_URL: "postgres://postgres:SECRET123@EP-PROD-POOLER.NEON.TECH:5432/db",
          DEV_DB_ALLOWED_HOSTS: "ep-prod.neon.tech",
          PROD_DB_HOST: "ep-prod.neon.tech",
        });
      } catch (e: any) {
        return e;
      }
    })();
    expect(err).toBeDefined();
    expect(err.message).toMatch(/production database host/i);
    expect(err.message).not.toContain("SECRET123");
  });

  it("refuses when DATABASE_URL is missing", () => {
    expect(() =>
      getConnectionString({ NODE_ENV: "development" })
    ).toThrow(/DATABASE_URL is required for local development/i);
  });

  it("refuses when NODE_ENV is unset (treated as development) and DATABASE_URL is remote", () => {
    const err = (() => {
      try {
        getConnectionString({
          DATABASE_URL: "postgres://postgres:SECRET123@remotedb.example.com:5432/db",
        });
      } catch (e: any) {
        return e;
      }
    })();
    expect(err).toBeDefined();
    expect(err.message).not.toContain("SECRET123");
  });
});

// ─── test ─────────────────────────────────────────────────────────────────────

describe("getConnectionString — test", () => {
  it("returns TEST_DATABASE_URL when it is a loopback host", () => {
    const result = getConnectionString({
      NODE_ENV: "test",
      TEST_DATABASE_URL: "postgres://postgres:SECRET123@127.0.0.1:5433/lifeloop_test_db",
    });
    expect(result).toBe("postgres://postgres:SECRET123@127.0.0.1:5433/lifeloop_test_db");
  });

  it("refuses when TEST_DATABASE_URL is missing", () => {
    expect(() =>
      getConnectionString({ NODE_ENV: "test" })
    ).toThrow(/TEST_DATABASE_URL is required for tests/i);
  });

  it("refuses when TEST_DATABASE_URL host is remote without ALLOW_REMOTE_TEST_DB", () => {
    expect(() =>
      getConnectionString({
        NODE_ENV: "test",
        TEST_DATABASE_URL: "postgres://postgres:SECRET123@remotehost:5432/testdb",
      })
    ).toThrow(/not a loopback address/i);
  });

  it("passes when TEST_DATABASE_URL is remote with ALLOW_REMOTE_TEST_DB=1", () => {
    expect(() =>
      getConnectionString({
        NODE_ENV: "test",
        TEST_DATABASE_URL: "postgres://postgres:SECRET123@remotehost:5432/testdb",
        ALLOW_REMOTE_TEST_DB: "1",
      })
    ).not.toThrow();
  });

  it("refuses when TEST_DATABASE_URL same host+db as DATABASE_URL", () => {
    expect(() =>
      getConnectionString({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://user:pass@ep-firefly-pooler.neon.tech/db",
        TEST_DATABASE_URL: "postgres://test:pass@ep-firefly.neon.tech/db",
        ALLOW_REMOTE_TEST_DB: "1",
      })
    ).toThrow(/same host and database/i);
  });
});

// ─── production ───────────────────────────────────────────────────────────────

describe("getConnectionString — production", () => {
  it("returns DATABASE_URL in production (any host allowed)", () => {
    const result = getConnectionString({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:SECRET123@ep-prod.neon.tech/proddb",
    });
    expect(result).toBe("postgres://user:SECRET123@ep-prod.neon.tech/proddb");
  });

  it("refuses when DATABASE_URL is missing in production", () => {
    expect(() =>
      getConnectionString({ NODE_ENV: "production" })
    ).toThrow(/DATABASE_URL is required in production/i);
  });
});

// ─── logDbStartup — secret redaction ──────────────────────────────────────────

describe("logDbStartup — no credentials in output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs host:port/dbname but never the password", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logDbStartup("postgres://postgres:SECRET123@127.0.0.1:5433/lifeloop_dev_db", { NODE_ENV: "development" });
    const output = spy.mock.calls.flat().join(" ");
    expect(output).toContain("127.0.0.1");
    expect(output).toContain("lifeloop_dev_db");
    expect(output).not.toContain("SECRET123");
    expect(output).not.toContain("postgres:SECRET");
  });
});
