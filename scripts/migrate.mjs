import { closeDb, getAppliedMigrations, getDb } from '../server/db.mjs';
import { seedDatabase } from '../server/seed.mjs';

const shouldSeed = process.argv.includes('--seed') || process.env.ENOMERA_SEED_DEMO === 'true';

const db = await getDb();
const migrations = await getAppliedMigrations(db);
console.log(`[migrate] Dialect: ${db.dialect}`);
console.log('[migrate] Applied migrations:', migrations.map((m) => `${m.version} (${m.applied_at})`).join(', '));

if (shouldSeed) {
  const res = await seedDatabase(db);
  console.log('[migrate] Demo seed:', res);
}

await closeDb();
