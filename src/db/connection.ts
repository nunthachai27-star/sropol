// T023: Connection factory — NODE_ENV-based routing

import type { DatabaseAdapter } from './adapter';
import { logger } from '@/lib/logger';

let instance: DatabaseAdapter | null = null;

// Named without the `use` prefix on purpose — eslint react-hooks rules
// would otherwise flag every caller as misusing a React Hook.
export function isSqliteEnabled(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.USE_SQLITE === 'true';
}

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (instance) return instance;

  if (isSqliteEnabled()) {
    const { SqliteAdapter } = await import('./sqlite-adapter');
    const path = process.env.NODE_ENV === 'test' ? ':memory:' : (process.env.SQLITE_PATH ?? 'dev.sqlite');
    instance = new SqliteAdapter(path);
    if (process.env.NODE_ENV !== 'test') {
      logger.info('sqlite_connected', { path });
    }
  } else {
    const { PostgresAdapter } = await import('./postgres-adapter');
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    instance = new PostgresAdapter(url);
  }

  return instance;
}

export async function closeDatabase(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

// For testing: reset the singleton
export function resetDatabaseInstance(): void {
  instance = null;
}
