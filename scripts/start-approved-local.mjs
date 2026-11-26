import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnomeraServer } from './server.mjs';

if (process.env.VERCEL) throw new Error('This fixture is local only. Remote previews require Neon, Blob and Resend.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.ENOMERA_DB_PATH = path.join(root, 'server/data/approved-local.sqlite');
process.env.ENOMERA_STORAGE_DIR = path.join(root, 'server/storage/approved-local');
process.env.ENOMERA_REQUIRE_REMOTE_INFRA = 'false';
process.env.ENOMERA_SEED_DEMO = 'true';
for (const [key,port] of [['AMBO',3001],['MINNE',3002],['ETHA',3003],['HELENA',3004]]) process.env[`ENOMERA_${key}_URL`] = `http://127.0.0.1:${port}`;
createEnomeraServer().listen(4319, '127.0.0.1', () => console.log('Local isolated Core fixture: http://127.0.0.1:4319 (local email outbox only)'));
