import { describe, it, expect } from 'vitest';
import { assertTestDatabaseGuard, assertTestDatabaseLiveGuard } from '../src/db/testDatabaseGuard';

describe('Database Safety Guard Verification', () => {
  it('should abort when NODE_ENV is production', () => {
    expect(() => {
      assertTestDatabaseGuard({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      });
    }).toThrowError(/NODE_ENV must be 'test'/);
  });

  it('should abort when NODE_ENV is development', () => {
    expect(() => {
      assertTestDatabaseGuard({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      });
    }).toThrowError(/NODE_ENV must be 'test'/);
  });

  it('should abort when NODE_ENV is unset', () => {
    expect(() => {
      assertTestDatabaseGuard({
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      });
    }).toThrowError(/NODE_ENV must be 'test'/);
  });

  it('should pass when NODE_ENV is test with loopback TEST_DATABASE_URL', () => {
    expect(() => {
      assertTestDatabaseGuard({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://user:pass@remotehost:5432/db',
        TEST_DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/testdb',
      });
    }).not.toThrow();
  });

  it('should abort when TEST_DATABASE_URL is a remote host without ALLOW_REMOTE_TEST_DB', () => {
    expect(() => {
      assertTestDatabaseGuard({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://user:pass@remotehost:5432/db',
        TEST_DATABASE_URL: 'postgres://test:test@remotehost2:5432/testdb',
      });
    }).toThrowError(/TEST_DATABASE_URL host 'remotehost2' is not a loopback address/);
  });

  it('should pass when TEST_DATABASE_URL is a remote host WITH ALLOW_REMOTE_TEST_DB', () => {
    expect(() => {
      assertTestDatabaseGuard({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://user:pass@remotehost:5432/db',
        TEST_DATABASE_URL: 'postgres://test:test@remotehost2:5432/testdb',
        ALLOW_REMOTE_TEST_DB: '1',
      });
    }).not.toThrow();
  });

  it('should abort when TEST_DATABASE_URL points to the same pooler/direct alias as DATABASE_URL', () => {
    expect(() => {
      assertTestDatabaseGuard({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://user:pass@ep-firefly-pooler.aws.neon.tech/db',
        TEST_DATABASE_URL: 'postgres://test:test@ep-firefly.aws.neon.tech/db',
        ALLOW_REMOTE_TEST_DB: '1',
      });
    }).toThrowError(/TEST_DATABASE_URL cannot point to the same host and database as DATABASE_URL/);
  });

  it('should abort when TEST_DATABASE_URL is missing', () => {
    expect(() => {
      assertTestDatabaseGuard({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db',
        TEST_DATABASE_URL: undefined,
      });
    }).toThrowError(/TEST_DATABASE_URL is required for tests/);
  });

  it('cleanup regex never touches lifeloop_test, public, or unrelated schemas', () => {
    const regex = /^lifeloop_test_[0-9]+_[a-z0-9]{6}(_w[0-9]+)?$/;
    expect(regex.test('public')).toBe(false);
    expect(regex.test('lifeloop_test')).toBe(false);
    expect(regex.test('information_schema')).toBe(false);
    expect(regex.test('pg_catalog')).toBe(false);
    expect(regex.test('users')).toBe(false);
    expect(regex.test('production')).toBe(false);
    expect(regex.test('lifeloop_test_e2e')).toBe(false);
    expect(regex.test('lifeloop_test_other')).toBe(false);
    expect(regex.test('lifeloop_test_12345')).toBe(false);
    expect(regex.test('lifeloop_test_1726756200000_a1b2c3')).toBe(true);
    expect(regex.test('lifeloop_test_1726756200000_a1b2c3_w2')).toBe(true);
  });

  it('should abort if live current_schema() does not match test schema', async () => {
    const mockSql = async () => [{ cd: 'lifeloop_test_db', cs: 'public', sp: 'public' }];
    await expect(
      assertTestDatabaseLiveGuard(mockSql, 'lifeloop_test')
    ).rejects.toThrowError(/current_schema\(\) resolved to 'public', but expected test schema 'lifeloop_test'/);
  });

  it('should abort if search_path lacks test schema', async () => {
    const mockSql = async () => [{ cd: 'lifeloop_test_db', cs: 'lifeloop_test', sp: 'public' }];
    await expect(
      assertTestDatabaseLiveGuard(mockSql, 'lifeloop_test')
    ).rejects.toThrowError(/search_path 'public' does not contain test schema 'lifeloop_test'/);
  });

  it('should pass when live query confirms test schema and search_path', async () => {
    const mockSql = async () => [{ cd: 'lifeloop_test_db', cs: 'lifeloop_test', sp: 'lifeloop_test' }];
    const res = await assertTestDatabaseLiveGuard(mockSql, 'lifeloop_test');
    expect(res.currentSchema).toBe('lifeloop_test');
    expect(res.searchPath).toBe('lifeloop_test');
  });
});
