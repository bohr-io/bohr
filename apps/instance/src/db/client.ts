import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export const createDb = (d1: D1Database) => drizzle(d1, { schema });

export type Db = ReturnType<typeof createDb>;
export type Project = typeof schema.projects.$inferSelect;
export type Hostname = typeof schema.hostnames.$inferSelect;
export type Deployment = typeof schema.deployments.$inferSelect;
