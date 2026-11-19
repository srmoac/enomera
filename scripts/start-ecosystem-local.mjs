import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createEnomeraServer } from './server.mjs';
import { getDb } from '../server/db.mjs';
import { seedDatabase } from '../server/seed.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
};

function serveDir(dirPath, port, label) {
  const root = path.resolve(dirPath);
  const srv = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root)) throw new Error('403');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      else if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file = file + '.html';
      else if (!fs.existsSync(file)) file = path.join(root, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  srv.listen(port, '127.0.0.1', () => console.log(`[${label}] http://127.0.0.1:${port}`));
  return srv;
}

const ENOMERA_PORT = Number(process.env.ENOMERA_PORT || 4319);
const AMBO_PORT = Number(process.env.AMBO_PORT || 3001);
const MINNE_PORT = Number(process.env.MINNE_PORT || 3002);
const ETHA_PORT = Number(process.env.ETHA_PORT || 3003);
const HELENA_PORT = Number(process.env.HELENA_PORT || 3004);

process.env.ENOMERA_AMBO_URL ||= `http://127.0.0.1:${AMBO_PORT}`;
process.env.ENOMERA_MINNE_URL ||= `http://127.0.0.1:${MINNE_PORT}`;
process.env.ENOMERA_ETHA_URL ||= `http://127.0.0.1:${ETHA_PORT}`;
process.env.ENOMERA_HELENA_URL ||= `http://127.0.0.1:${HELENA_PORT}`;

const db = await getDb();
await seedDatabase(db);

createEnomeraServer(db).listen(ENOMERA_PORT, '127.0.0.1', () => {
  console.log(`[Enomera + Core API] http://127.0.0.1:${ENOMERA_PORT}  (Portal: http://127.0.0.1:${ENOMERA_PORT}/portal)`);
});
serveDir('C:/Users/mrsao/Documents/Enomera/ambo/out', AMBO_PORT, 'Ambo');
serveDir('C:/Users/mrsao/Documents/Enomera/minne/out', MINNE_PORT, 'Minne');
serveDir('C:/Users/mrsao/Documents/Enomera/etha/dist', ETHA_PORT, 'Etha');

const helena = spawn('node', ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(HELENA_PORT)], {
  cwd: 'C:/Users/mrsao/Documents/Enomera/helena-duarte',
  stdio: 'inherit',
});
console.log(`[Helena Duarte] http://127.0.0.1:${HELENA_PORT}`);

process.on('SIGINT', () => {
  helena.kill();
  process.exit(0);
});
