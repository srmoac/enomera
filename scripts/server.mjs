import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from '../server/router.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../public');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
};

const port = Number(process.env.PORT || 4319);

export function createEnomeraServer(customDb = null) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApiRequest(req, res, customDb);
        return;
      }
      let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + path.sep) && file !== root) throw new Error('Forbidden');
      if (url.pathname.startsWith('/convite/')) file = path.join(root, 'piloto', 'convite.html');
      else if (/^\/piloto\/painel\/?$/.test(url.pathname)) file = path.join(root, 'piloto', 'painel.html');
      if (!path.extname(file)) file = path.join(root, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/server.mjs')) {
  createEnomeraServer().listen(port, '127.0.0.1', () => {
    console.log(`Enomera (Frontend + Core API) listening at http://127.0.0.1:${port}`);
  });
}
