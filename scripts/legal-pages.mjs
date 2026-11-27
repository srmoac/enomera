// Gera /termos e /privacidade a partir de docs/legal/*.md (Markdown simples).
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// `código` vira <code>; negrito, links e e-mails seguem como antes.
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
  .replace(/\b([\w.+-]+@[\w-]+\.[\w.]+)\b/g, '<a href="mailto:$1">$1</a>');

// Âncora de título: "## 4. Com quem compartilhamos" vira id="com-quem-compartilhamos".
export const headingId = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/^\d+\.\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function markdownToHtml(md) {
  const out = [];
  // Ids já usados pelas âncoras manuais (<a id="...">) não se repetem nos títulos.
  const used = new Set([...md.matchAll(/<a id="([\w-]+)"><\/a>/g)].map((m) => m[1]));
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^<a id="[\w-]+"><\/a>$/.test(line.trim())) { out.push(line.trim()); i++; continue; }
    const h = /^(#{1,3}) (.+)$/.exec(line);
    if (h) {
      const id = headingId(h[2]);
      const dup = used.has(id) || !id;
      used.add(id);
      out.push(`<h${h[1].length}${dup ? '' : ` id="${id}"`}>${inline(h[2])}</h${h[1].length}>`); i++; continue;
    }
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

// Página no padrão do produto: Liquid Glass (/glass), Manrope, tema claro único e motion-tokens.
function page(title, body, slug) {
  const nav = [['termos', 'Termos'], ['privacidade', 'Privacidade']]
    .map(([s, l]) => `<a href="/${s}"${s === slug ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  return `<!doctype html>
<html lang="pt-BR" data-theme="light">
<head>
<meta charset="UTF-8"><meta name="color-scheme" content="light only">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F0F4FE">
<title>${title} | Enomera</title>
<link rel="icon" type="image/svg+xml" href="/assets/brand.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/motion-tokens.css">
<link rel="stylesheet" href="/glass/liquid-glass.css">
<link rel="stylesheet" href="/piloto/piloto.css">
<link rel="stylesheet" href="/legal.css">
</head>
<body class="lgl">
<div class="pl-backdrop" aria-hidden="true"><i></i><i></i><i></i></div>
<a class="lgl-skip" href="#conteudo">Pular para o texto</a>
<header class="lgl-top lg" data-glass="regular" data-glass-tint="enomera">
  <a class="lgl-brand" href="/" translate="no"><img src="/assets/brand.svg" width="28" height="24" alt="">enomera</a>
  <nav class="lgl-nav" aria-label="Documentos">${nav}</nav>
</header>
<main id="conteudo" class="lgl-card lg pl-in" data-glass="reading" data-glass-tint="enomera" tabindex="-1">
${body}
</main>
<footer class="lgl-foot">
  <span>Enomera · Atendimento remoto nacional</span>
  <span><a href="/termos">Termos de Uso</a> · <a href="/privacidade">Privacidade</a> · <a href="/privacidade#cookies" data-eno-consent>Preferências de privacidade</a></span>
  <a class="pl-btn is-quiet" href="/">Voltar ao início</a>
</footer>
<script type="module" src="/glass/liquid-glass-auto.js"></script>
<script src="/eno-consent.js" defer></script>
<script src="/piloto/uso.js" data-produto="enomera" defer></script>
</body>
</html>`;
}

// Contato usado nos documentos enquanto não há e-mail institucional.
const PILOT_CONTACT = ['mrsaocwork', 'gmail.com'].join('@');

export async function buildLegalPages(outDir = 'dist') {
  const pages = [
    ['termos', 'Termos de Uso', 'docs/legal/termos-de-uso.md'],
    ['privacidade', 'Política de Privacidade', 'docs/legal/politica-de-privacidade.md'],
  ];
  for (const [slug, title, src] of pages) {
    // E-mail de contato institucional, quando configurado no ambiente do build (ENOMERA_CONTACT_EMAIL).
    const contact = String(process.env.ENOMERA_CONTACT_EMAIL || '').trim();
    let md = await readFile(src, 'utf8');
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) md = md.replaceAll(PILOT_CONTACT, contact);
    const html = page(title, markdownToHtml(md), slug);
    await mkdir(`${outDir}/${slug}`, { recursive: true });
    await writeFile(`${outDir}/${slug}/index.html`, html, 'utf8');
  }
}
