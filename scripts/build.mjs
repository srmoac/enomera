import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { buildLegalPages } from './legal-pages.mjs';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await buildLegalPages('dist');

// Material interno não vai para o ar: a demonstração e o README do módulo de vidro ficam só no repositório.
for (const f of ['glass/index.html', 'glass/demo.js', 'glass/demo.css', 'glass/README.md']) await rm(`dist/${f}`, { force: true });

// Uma folha de estilo por página: as folhas locais são juntadas, na mesma ordem, em um arquivo só
// (menos requisições bloqueando a primeira pintura). As fontes do Google continuam à parte.
async function bundleCss(file) {
  let html = await readFile(file, 'utf8');
  const links = [...html.matchAll(/<link rel="stylesheet" href="(\/[^"]+\.css)">/g)];
  if (links.length < 2) return;
  const parts = [];
  for (const [, href] of links) parts.push(`/* ${href} */\n${await readFile(`dist${href}`, 'utf8')}`);
  const css = parts.join('\n');
  const name = `/bundle-${createHash('sha256').update(css).digest('hex').slice(0, 10)}.css`;
  await writeFile(`dist${name}`, css, 'utf8');
  links.forEach(([tag], i) => { html = html.replace(tag, i === 0 ? `<link rel="stylesheet" href="${name}">` : ''); });
  await writeFile(file, html, 'utf8');
}
// Só a home: em /configurar há estilos embutidos entre as folhas e a ordem importa.
await bundleCss('dist/index.html');

// E-mail de contato institucional, quando configurado (ENOMERA_CONTACT_EMAIL): troca o contato do piloto na home.
const contactEmail = String(process.env.ENOMERA_CONTACT_EMAIL || '').trim();
if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
  const pilotContact = ['mrsaocwork', 'gmail.com'].join('@');
  const html = await readFile('dist/index.html', 'utf8');
  await writeFile('dist/index.html', html.replaceAll(pilotContact, contactEmail), 'utf8');
}

// Inject preview/environment ecosystem URLs into dist/index.html when configured in Vercel Preview/Prod env
const envMap = {
  __ENOMERA_AMBO_URL: process.env.ENOMERA_AMBO_URL || process.env.NEXT_PUBLIC_AMBO_URL || '',
  __ENOMERA_MINNE_URL: process.env.ENOMERA_MINNE_URL || process.env.NEXT_PUBLIC_MINNE_URL || '',
  __ENOMERA_ETHA_URL: process.env.ENOMERA_ETHA_URL || process.env.NEXT_PUBLIC_ETHA_URL || '',
  __ENOMERA_HELENA_URL: process.env.ENOMERA_HELENA_URL || process.env.NEXT_PUBLIC_HELENA_URL || '',
  __ENOMERA_SITES_URL: process.env.ENOMERA_SITES_URL || process.env.NEXT_PUBLIC_SITES_URL || '',
};
const activeEntries = Object.entries(envMap).filter(([, v]) => Boolean(v));
if (activeEntries.length > 0) {
  const scriptTag = `<script>${activeEntries.map(([k, v]) => `window.${k}=${JSON.stringify(v)};`).join('')}</script>`;
  for (const file of ['dist/index.html', 'dist/configurar.html', 'dist/piloto/painel.html']) {
    let html = await readFile(file, 'utf8');
    html = html.replace('</head>', `${scriptTag}\n</head>`);
    await writeFile(file, html, 'utf8');
  }
}

// Previews e branches não entram em busca: só produção pode ser indexada.
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
  let html = await readFile('dist/index.html', 'utf8');
  html = html.replace('</head>', '<meta name="robots" content="noindex, nofollow">\n</head>');
  await writeFile('dist/index.html', html, 'utf8');
  await writeFile('dist/robots.txt', 'User-agent: *\nDisallow: /\n', 'utf8');
} else {
  // Produção: o que pode ser achado no Google. As áreas logadas, o painel do piloto e os convites
  // recebem X-Robots-Tag: noindex pelo vercel.json (bloquear aqui impediria o Google de ver o noindex).
  const SITE = 'https://enomera.vercel.app';
  await writeFile('dist/robots.txt', [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE}/sitemap.xml`,
    'Sitemap: https://enomera-sites.vercel.app/sitemap.xml',
    '',
  ].join('\n'), 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    ['/', '1.0', 'weekly'],
    ['/site/', '0.9', 'weekly'],
    ['/agendamento/', '0.9', 'weekly'],
    ['/agendamento/profissional/', '0.7', 'monthly'],
    ['/agendamento/paciente/', '0.6', 'monthly'],
    ['/termos', '0.3', 'yearly'],
    ['/privacidade', '0.3', 'yearly'],
  ];
  const body = urls.map(([u, pr, cf]) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`).join('\n');
  await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, 'utf8');
}

// Google Search Console: código de verificação (tag HTML) vindo de GOOGLE_SITE_VERIFICATION, ou do
// arquivo docs/seo/google-verificacao.txt quando a variável não existe. Só a home precisa da tag.
{
  let code = String(process.env.GOOGLE_SITE_VERIFICATION || '').trim();
  if (!code) code = (await readFile('docs/seo/google-verificacao.txt', 'utf8').catch(() => '')).split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
  const m = code.match(/content="([^"]+)"/); if (m) code = m[1];
  if (/^[\w-]{10,100}$/.test(code)) {
    const html = await readFile('dist/index.html', 'utf8');
    await writeFile('dist/index.html', html.replace('</head>', `<meta name="google-site-verification" content="${code}">\n</head>`), 'utf8');
  }
}

console.log('Built dist');
