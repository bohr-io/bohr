import type { D1Migration } from 'cloudflare:test';
import type { Env as InstanceEnv } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends InstanceEnv {
      TEST_MIGRATIONS: D1Migration[];
      // The test configuration binds the managed-hosting storage
      ROUTES: KVNamespace;
      BUNDLES: R2Bucket;
      EMPTY_DB: D1Database;
    }
  }
}
