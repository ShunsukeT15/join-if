// CLI: DATABASE_URL=postgres://... npm run migrate -w @himitsu/api
import { migrate } from './migrator.js';
import { createPgPool } from './pgClient.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const pool = createPgPool(url);
try {
  const applied = await migrate(pool, console.log);
  console.log(applied.length ? `done (${applied.length} applied)` : 'up to date');
} finally {
  await pool.end();
}
