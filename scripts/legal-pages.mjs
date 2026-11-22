// Gera /termos e /privacidade a partir de docs/legal/*.md (Markdown simples).
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
  .replace(/\b([\w.+-]+@[\w-]+\.[\w.]+)\b/g, '<a href="mailto:$1">$1</a>');

export function markdownToHtml(md) {
  const out = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^<a id="[\w-]+"><\/a>$/.test(line.trim())) { out.push(line.trim()); i++; continue; }
    const h = /^(#{1,3}) (.+)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (line.startsWith('> ')) { out.push(`<aside class="legal-note">${inline(line.slice(2))}</aside>`); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
      const cells = (r) => r.slice(1, -1).split('|').map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(`<div class="legal-table"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) { items.push(lines[i].replace(/^(- |\d+\. )/, '')); i++; }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|> |\||- |\d+\. |<a id)/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

function page(title, body) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${title} | Enomera</title><link rel="icon" type="image/svg+xml" href="/assets/brand.svg"><link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet"><style>
:root{--bg:#F0F4FE;--ink:#1C2240;--muted:#56607F;--line:#D6DDF2;--card:#fff;--accent:#3B4FB8}
@media (prefers-color-scheme:dark){:root{--bg:#10132A;--ink:#EEF1FC;--muted:#A9B1CE;--line:#2A3157;--card:#171B38;--accent:#9AA8F0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 Manrope,system-ui,sans-serif}
header{max-width:760px;margin:0 auto;padding:20px 16px;display:flex;justify-content:space-between;align-items:center}
header a{color:var(--ink);text-decoration:none;font-weight:600}main{max-width:760px;margin:0 auto;padding:8px 16px 64px}
h1{font:400 clamp(32px,6vw,44px)/1.15 'Bodoni Moda',serif;margin:8px 0 4px}h2{font-size:20px;margin:36px 0 8px}
a{color:var(--accent)}.legal-note{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:16px 0}
.legal-table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:15px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
li{margin:4px 0}footer{max-width:760px;margin:0 auto;padding:0 16px 40px;color:var(--muted);font-size:14px}
</style></head><body><header><a href="/">enomera</a><nav><a href="/termos">Termos</a> · <a href="/privacidade">Privacidade</a></nav></header><main>${body}</main><footer>Enomera · Atendimento remoto nacional</footer></body></html>`;
}

export async function buildLegalPages(outDir = 'dist') {
  const pages = [
    ['termos', 'Termos de Uso', 'docs/legal/termos-de-uso.md'],
    ['privacidade', 'Política de Privacidade', 'docs/legal/politica-de-privacidade.md'],
  ];
  for (const [slug, title, src] of pages) {
    const html = page(title, markdownToHtml(await readFile(src, 'utf8')));
    await mkdir(`${outDir}/${slug}`, { recursive: true });
    await writeFile(`${outDir}/${slug}/index.html`, html, 'utf8');
  }
}
