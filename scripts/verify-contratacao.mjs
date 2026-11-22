// Uso: npm run dev (outra aba) e depois: node scripts/verify-contratacao.mjs docs/contratacao/evidence
// Requer Chromium do Playwright. BASE=http://127.0.0.1:4319 por padrão.
// Percurso de contratação: escolha → conta → código (erro e acerto) → revisão → retorno → ativação → portal.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:4319';
const OUT = process.argv[2] || 'docs/contratacao/evidence';
await import('node:fs').then((fs) => fs.mkdirSync(OUT, { recursive: true }));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); if (!ok) console.log('FAIL', name, detail); };

async function codeFor(email) {
  const r = await fetch(`${BASE}/api/v1/dev/outbox?recipient=${encodeURIComponent(email)}`).then((x) => x.json());
  return /(\d{6})/.exec(r.messages[0].body_preview)[1];
}

async function run(browserType, label, viewport, scenario) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const tag = `${label}-${scenario}`;
  const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${n}.png`, fullPage: true });
  const email = `teste.${scenario}.${label}.${Date.now()}@exemplo.invalid`;

  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-flow-step="choice"]');
  const body = await page.innerText('#portal');
  check(`${tag}: sem versão interna do catálogo`, !/sim-v2|CATÁLOGO|SIMULAÇÃO|Retorno automático/i.test(body));
  await page.waitForFunction(() => /89,00/.test(document.querySelector('.eno-sum-total strong')?.textContent || ''));
  check(`${tag}: combo mostra desconto como linha`, /Desconto do combo/.test(await page.textContent('.eno-sum')));
  check(`${tag}: cobrado hoje R$ 0,00`, /Cobrado hoje: R\$\s0,00/.test(await page.textContent('.eno-sum-today')));
  await shot('1-escolha-combo');

  if (scenario === 'soambo') {
    await page.click('button[data-toggle-prod="minne"]');
    await page.waitForFunction(() => /39,00/.test(document.querySelector('.eno-sum-total strong')?.textContent || ''));
    check(`${tag}: só Ambo some o desconto e vira dica`, /Adicione Minne/.test(await page.textContent('.eno-sum')) && !/Desconto do combo/.test(await page.textContent('.eno-sum')));
    await shot('2-escolha-so-ambo');
  }
  if (scenario === 'licenca') {
    await page.click('[data-viewmode="permanent"]');
    await page.waitForFunction(() => /2\.180,00/.test(document.querySelector('.eno-sum-total strong')?.textContent || ''));
    const t = await page.textContent('.eno-sum');
    check(`${tag}: licença mostra R$ 790 + R$ 1.390 e pendências em definição`, /790,00/.test(t) && /1\.390,00/.test(t) && /em definição/.test(t));
    await shot('2-escolha-licenca');
  }

  await page.click('#eno-flow-continue');
  await page.waitForSelector('#eno-email');
  check(`${tag}: conta não mostra nome antes da verificação`, !/Helena|Bem-vind/.test(await page.innerText('#portal-content')));
  const expectedLabel = scenario === 'soambo' ? 'Ambo · Mensal' : scenario === 'licenca' ? 'Ambo + Minne · Licença permanente' : 'Ambo + Minne · Mensal';
  const summaryText = (await page.textContent(viewport.width < 600 ? '.eno-sum-compact' : '.eno-flow-side .eno-sum')).replace(/\s+/g, ' ');
  check(`${tag}: conta mantém a combinação escolhida`, summaryText.includes(expectedLabel.split(' · ')[0]) && (viewport.width >= 600 || summaryText.includes(expectedLabel)), summaryText);
  await page.fill('#eno-email', email);
  await shot('3-conta');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#otp-0');
  check(`${tag}: código mostra o e-mail e o reenvio com tempo`, (await page.innerText('#portal-content')).includes(email) && /Reenviar código em 0:5\d|1:00/.test(await page.textContent('#eno-code-form')));
  await page.fill('#otp-0', '000000'); // 6º dígito envia sozinho
  await page.waitForSelector('#eno-code-err');
  check(`${tag}: código incorreto avisa e preserva a combinação`, /Código incorreto.*combinação continua guardada/.test(await page.textContent('#eno-code-err')));
  await shot('4-codigo-incorreto');

  const code = await codeFor(email);
  await page.click('#otp-0');
  await page.keyboard.insertText(code); // equivale a colar: um evento de entrada com os 6 dígitos
  const filled = await page.$$eval('.eno-otp-digit', (els) => els.map((e) => e.textContent).join(''));
  check(`${tag}: colar preenche os seis dígitos`, filled === code, filled);
  await shot('5-codigo');
  await page.waitForSelector('[data-flow-step="review"]');
  await page.waitForFunction(() => document.querySelector('.eno-sum-total strong')?.textContent);
  const review = (await page.innerText('#portal-content')).replace(/\s+/g, ' ');
  check(`${tag}: revisão diz conta verificada`, /Conta verificada/.test(review));
  if (scenario === 'soambo') check(`${tag}: revisão mostra Minne como não incluído e total R$ 39`, /Não incluído/.test(review) && /39,00\/mês/.test(review), review.slice(0, 400));
  else if (scenario === 'licenca') check(`${tag}: revisão mantém licença`, /Licença permanente|licença permanente/.test(review) && /2\.180,00/.test(review));
  else check(`${tag}: revisão mantém combo mensal`, /89,00\/mês/.test(review));
  await shot('6-revisao');

  // Retorno: alterar combinação e voltar à revisão com escolha e conta mantidas.
  await page.click('#eno-review-change');
  await page.waitForSelector('[data-flow-step="choice"]');
  const ret = (await page.innerText('#portal-content')).replace(/\s+/g, ' ');
  check(`${tag}: retorno avisa que escolha e conta foram mantidas`, /Você voltou da revisão/.test(ret) && /conta continua verificada/.test(ret));
  check(`${tag}: CTA do retorno é Voltar à revisão`, (await page.textContent('#eno-flow-continue')).includes('Voltar à revisão'));
  await shot('7-retorno');

  // Recarregar no retorno: a combinação vem da conta.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-flow-step="choice"]');
  await page.waitForFunction(() => document.querySelector('.eno-sum-total strong')?.textContent);
  const afterReload = await page.textContent('.eno-sum');
  const expectTotal = scenario === 'soambo' ? '39,00' : scenario === 'licenca' ? '2.180,00' : '89,00';
  check(`${tag}: recarregar mantém a combinação da conta`, afterReload.includes(expectTotal), afterReload.replace(/\s+/g, ' '));

  await page.click('#eno-flow-continue');
  await page.waitForSelector('[data-flow-step="review"]');
  await page.click('#eno-checkout-submit');
  await page.waitForSelector('#eno-checkout-submit[aria-busy="true"]');
  check(`${tag}: ativando informa que continua se sair`, /se você sair, a ativação continua/.test(await page.innerText('#portal-content')));
  await shot('8-ativando');
  await page.waitForSelector('.eno-activation-banner', { timeout: 10000 });
  const banner = await page.textContent('.eno-activation-banner');
  const expBanner = scenario === 'soambo' ? /Ambo ativo · cobrado hoje R\$\s0,00/ : /Ambo e Minne ativos · cobrado hoje R\$\s0,00/;
  check(`${tag}: portal confirma a combinação ativa e R$ 0 hoje`, expBanner.test(banner), banner);
  const combo = (await page.textContent('[data-portal-combo]')).replace(/\s+/g, ' ');
  check(`${tag}: portal mostra a combinação escolhida`, combo.includes(expectedLabel), combo);
  await shot('9-portal');

  const me = await page.evaluate(async () => {
    const t = sessionStorage.getItem('enomera_session_token_v1');
    return fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json());
  });
  const ents = me.entitlements || {};
  const okEnts = scenario === 'soambo'
    ? ents.ambo?.status === 'active' && !ents.minne
    : ents.ambo?.status === 'active' && ents.minne?.status === 'active';
  check(`${tag}: direitos ativados conforme a escolha`, okEnts, JSON.stringify(ents));
  if (scenario === 'licenca') check(`${tag}: licença registrada como licença`, ents.ambo?.billingMode === 'permanent_hypothesis');

  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`${tag}: sem rolagem horizontal`, !hscroll);
  check(`${tag}: sem erros no console`, errors.length === 0, errors.join(' | '));
  await browser.close();
}

const matrix = [
  [chromium, 'chromium-1440', { width: 1440, height: 1000 }],
  [chromium, 'chromium-390', { width: 390, height: 844 }],
  
];
const scenarios = (process.env.SCENARIOS || 'combo,soambo,licenca').split(',');
for (const [bt, label, vp] of matrix) {
  for (const sc of scenarios) {
    try { await run(bt, label, vp, sc); } catch (e) { check(`${label}-${sc}: execução`, false, String(e).slice(0, 400)); }
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} verificações passaram`);
for (const f of failed) console.log('  ✗', f.name, f.detail.slice(0, 300));
process.exit(failed.length ? 1 : 0);
