import type { Env as ProjectEnv } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends ProjectEnv {}
  }
}
