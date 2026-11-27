import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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

// Mesmos cabeçalhos de segurança da Vercel (vercel.json), para o teste local ser fiel.
let securityHeaders = {};
try {
  const vercel = JSON.parse(readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf8'));
  const global = (vercel.headers || []).find((h) => h.source === '/(.*)');
  for (const h of global?.headers || []) securityHeaders[h.key] = h.value;
} catch { securityHeaders = {}; }

export function createEnomeraServer(customDb = null) {
  return http.createServer(async (req, res) => {
    try {
      for (const [k, v] of Object.entries(securityHeaders)) res.setHeader(k, k === 'Content-Security-Policy' ? v.replace(' upgrade-insecure-requests', '').replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:* http://localhost:*") : v);
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApiRequest(req, res, customDb);
        return;
      }
      let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + path.sep) && file !== root) throw new Error('Forbidden');
      if (url.pathname.startsWith('/convite/')) file = path.join(root, 'piloto', 'convite.html');
      else if (/^\/piloto\/painel\/?$/.test(url.pathname)) file = path.join(root, 'piloto', 'painel.html');
      else if (/^\/piloto\/como-funciona\/?$/.test(url.pathname)) file = path.join(root, 'piloto', 'como-funciona.html');
      else if (/^\/configurar\/?$/.test(url.pathname)) file = path.join(root, 'configurar.html');
      // Como na Vercel: só a home e as rotas do portal caem no index; o resto que não existe é 404.
      else if (/^\/(portal|conta|checkout)?\/?$/.test(url.pathname)) file = path.join(root, 'index.html');
      else if (!path.extname(file)) throw new Error('Not found');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      // Mesma página 404 que a Vercel serve a partir de dist/404.html.
      let page = null;
      try { page = await readFile(path.join(root, '404.html')); } catch {}
      res.writeHead(404, { 'Content-Type': page ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' });
      res.end(page || 'Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/server.mjs')) {
  createEnomeraServer().listen(port, '127.0.0.1', () => {
    console.log(`Enomera (Frontend + Core API) listening at http://127.0.0.1:${port}`);
  });
}
