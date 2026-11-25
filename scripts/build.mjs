import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { buildLegalPages } from './legal-pages.mjs';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await buildLegalPages('dist');

// Inject preview/environment ecosystem URLs into dist/index.html when configured in Vercel Preview/Prod env
const envMap = {
  __ENOMERA_AMBO_URL: process.env.ENOMERA_AMBO_URL || process.env.NEXT_PUBLIC_AMBO_URL || '',
  __ENOMERA_MINNE_URL: process.env.ENOMERA_MINNE_URL || process.env.NEXT_PUBLIC_MINNE_URL || '',
  __ENOMERA_ETHA_URL: process.env.ENOMERA_ETHA_URL || process.env.NEXT_PUBLIC_ETHA_URL || '',
  __ENOMERA_HELENA_URL: process.env.ENOMERA_HELENA_URL || process.env.NEXT_PUBLIC_HELENA_URL || '',
};
const activeEntries = Object.entries(envMap).filter(([, v]) => Boolean(v));
if (activeEntries.length > 0) {
  const scriptTag = `<script>${activeEntries.map(([k, v]) => `window.${k}=${JSON.stringify(v)};`).join('')}</script>`;
  for (const file of ['dist/index.html', 'dist/configurar.html']) {
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
}

console.log('Built dist');
