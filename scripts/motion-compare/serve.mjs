import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [dir, port] = [process.argv[2], +process.argv[3]];
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.mp4':'video/mp4', '.png':'image/png' };
http.createServer((q, s) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (['/', '/portal', '/conta', '/checkout'].includes(p.replace(/\/$/, '') || '/')) p = '/index.html';
  const f = path.join(dir, p);
  if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('nf'); }
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(s);
}).listen(port);
