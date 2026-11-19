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

const db = getDb();
seedDatabase(db);

createEnomeraServer(db).listen(4319, '127.0.0.1', () => {
  console.log('[Enomera + Core API] http://127.0.0.1:4319  (Portal: http://127.0.0.1:4319/portal)');
});
serveDir('C:/Users/mrsao/Documents/Enomera/ambo/out', 3001, 'Ambo');
serveDir('C:/Users/mrsao/Documents/Enomera/minne/out', 3002, 'Minne');
serveDir('C:/Users/mrsao/Documents/Enomera/etha/dist', 3003, 'Etha');

const helena = spawn('node', ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3004'], {
  cwd: 'C:/Users/mrsao/Documents/Enomera/helena-duarte',
  stdio: 'inherit',
});
console.log('[Helena Duarte] http://127.0.0.1:3004');

process.on('SIGINT', () => {
  helena.kill();
  process.exit(0);
});
