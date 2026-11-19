import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });

// Inject preview/environment ecosystem URLs into dist/index.html when configured in Vercel Preview/Prod env
const envMap = {
  __ENOMERA_AMBO_URL: process.env.ENOMERA_AMBO_URL || process.env.NEXT_PUBLIC_AMBO_URL || '',
  __ENOMERA_MINNE_URL: process.env.ENOMERA_MINNE_URL || process.env.NEXT_PUBLIC_MINNE_URL || '',
  __ENOMERA_ETHA_URL: process.env.ENOMERA_ETHA_URL || process.env.NEXT_PUBLIC_ETHA_URL || '',
  __ENOMERA_HELENA_URL: process.env.ENOMERA_HELENA_URL || process.env.NEXT_PUBLIC_HELENA_URL || '',
};
const activeEntries = Object.entries(envMap).filter(([, v]) => Boolean(v));
if (activeEntries.length > 0) {
  let html = await readFile('dist/index.html', 'utf8');
  const scriptTag = `<script>${activeEntries.map(([k, v]) => `window.${k}=${JSON.stringify(v)};`).join('')}</script>`;
  html = html.replace('</head>', `${scriptTag}\n</head>`);
  await writeFile('dist/index.html', html, 'utf8');
}

console.log('Built dist');
