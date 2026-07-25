import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const client = neon(process.env.NEON_DATABASE_URL!);

/** Drizzle ORM instance — use this for all new code. */
export const db = drizzle({ client, schema });

/** Legacy raw-SQL tagged-template client (`import sql from '@/lib/db'`). */
export default client;

export * from './schema';
