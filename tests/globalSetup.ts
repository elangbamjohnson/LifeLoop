import { setupTestSchema } from '../src/db/migrateTestSchema';

export async function setup() {
  console.log('[Vitest GlobalSetup] Ensuring isolated test database schema is ready...');
  await setupTestSchema();
  console.log('[Vitest GlobalSetup] Isolated test database schema is ready.');
}
