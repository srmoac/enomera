import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPath = 'C:/Users/mrsao/OneDrive/Documentos/ChatGPT/Enomora/node_modules/playwright';
const { chromium, webkit } = require(playwrightPath);

const ARTIFACT_DIR = 'C:/Users/mrsao/.gemini/antigravity/brain/f27c97a2-200c-4a2e-a143-4106969045a7/evidence/real-users-v3';
const SHOTS_DIR = path.join(ARTIFACT_DIR, 'shots');
const VIDEOS_DIR = path.join(ARTIFACT_DIR, 'videos');
const FFMPEG = 'C:/Users/mrsao/.stacher/ffmpeg.exe';
fs.mkdirSync(SHOTS_DIR, { recursive: true });
fs.mkdirSync(VIDEOS_DIR, { recursive: true });

const DB_PATH = path.join(ARTIFACT_DIR, 'real-users-v3.sqlite');
const STORAGE_DIR = path.join(ARTIFACT_DIR, 'private-files');
if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH, { force: true });
if (fs.existsSync(STORAGE_DIR)) fs.rmSync(STORAGE_DIR, { recursive: true, force: true });

const PORTS = {
  enomera: 4419,
  ambo: 3101,
  minne: 3102,
  etha: 3103,
  helena: 3104,
};

const URLS = {
  enomera: `http://127.0.0.1:${PORTS.enomera}`,
  ambo: `http://127.0.0.1:${PORTS.ambo}`,
  minne: `http://127.0.0.1:${PORTS.minne}`,
  etha: `http://127.0.0.1:${PORTS.etha}`,
  helena: `http://127.0.0.1:${PORTS.helena}`,
};

async function attachPortRemap(ctx) {
  await ctx.route('http://127.0.0.1:4319/**', async (route) => {
    const req = route.request();
    const targetUrl = req.url().replace('http://127.0.0.1:4319', URLS.enomera);
    const resp = await route.fetch({ url: targetUrl });
    await route.fulfill({ response: resp });
  });
  await ctx.route('http://127.0.0.1:3001/**', async (route) => {
    const req = route.request();
    const targetUrl = req.url().replace('http://127.0.0.1:3001', URLS.ambo);
    const resp = await route.fetch({ url: targetUrl });
    await route.fulfill({ response: resp });
  });
  await ctx.route('http://127.0.0.1:3004/**', async (route) => {
    const req = route.request();
    const targetUrl = req.url().replace('http://127.0.0.1:3004', URLS.helena);
    const resp = await route.fetch({ url: targetUrl });
    await route.fulfill({ response: resp });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

function transcodeMp4(webmPath, outName) {
  const mp4Path = path.join(VIDEOS_DIR, outName);
  execFileSync(FFMPEG, [
    '-y',
    '-i', webmPath,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    mp4Path,
  ], { stdio: 'pipe' });
  return mp4Path;
}

async function fetchLatestCode(email) {
  const r = await fetch(`${URLS.enomera}/api/v1/dev/outbox?recipient=${encodeURIComponent(email)}`);
  const d = await r.json();
  const txt = d.messages?.[0]?.body_preview || '';
  const m = txt.match(/\b(\d{6})\b/);
  if (!m) throw new Error(`No 6-digit code in outbox for ${email}`);
  return m[1];
}

function startEcosystem() {
  const child = spawn(process.execPath, ['C:/Users/mrsao/Documents/Enomera/enomera/scripts/start-ecosystem-local.mjs'], {
    cwd: 'C:/Users/mrsao/Documents/Enomera/enomera',
    env: {
      ...process.env,
      ENOMERA_DB_PATH: DB_PATH,
      ENOMERA_STORAGE_DIR: STORAGE_DIR,
      ENOMERA_PORT: String(PORTS.enomera),
      AMBO_PORT: String(PORTS.ambo),
      MINNE_PORT: String(PORTS.minne),
      ETHA_PORT: String(PORTS.etha),
      HELENA_PORT: String(PORTS.helena),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

async function waitEcosystemReady() {
  await Promise.all([
    waitUp(`${URLS.enomera}/api/v1/health`),
    waitUp(URLS.ambo),
    waitUp(URLS.minne),
    waitUp(URLS.etha),
    waitUp(URLS.helena),
  ]);
}

const report = {
  timestamp: new Date().toISOString(),
  notePhysicalSafari: 'Validado em Chromium e WebKit automatizados (Playwright 1.65.1) em 1440x900 e 390x844; Safari em iPhone físico não foi testado.',
  journeys: {},
  matrix: {},
  videos: [],
  screenshots: [],
};

let launcher = startEcosystem();

try {
  await waitEcosystemReady();
  const health = await (await fetch(`${URLS.enomera}/api/v1/health`)).json();
  report.health = health;
  if (!health.integrations?.database?.appliedMigrations?.includes('002_real_users_and_indexes')) {
    throw new Error(`Expected versioned migrations in /api/v1/health, got: ${JSON.stringify(health)}`);
  }
  console.log('Ecosystem UP. Migrations:', health.integrations.database.appliedMigrations);

  const chBrowser = await chromium.launch({ headless: true });
  const wkBrowser = await webkit.launch({ headless: true });

  const ts = Date.now();
  const sofiaEmail = `sofia.real.${ts}@exemplo.invalid`;
  const sofiaPass = 'SofiaReal!2026';
  const tiagoEmail = `tiago.isolado.${ts}@exemplo.invalid`;
  const tiagoPass = 'TiagoReal!2026';
  let sofiaSlug = '';

  // =========================================================================
  // VIDEO 1 (1x real speed):
  // Real Account A Signup -> Email Code -> Verify -> Simulated Checkout (Ambo+Minne+Etha)
  // -> Portal -> Close Browser -> New Browser ("Outro aparelho") Login -> Persisted Active Products
  // =========================================================================
  {
    const ctx1 = await chBrowser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: VIDEOS_DIR, size: { width: 1440, height: 900 } },
    });
    await attachPortRemap(ctx1);
    const page = await ctx1.newPage();

    await page.goto(`${URLS.enomera}/checkout`);
    await page.waitForSelector('#eno-bill-seg');
    await sleep(500);
    // Select Ambo + Minne + Etha
    await page.click('#cb-etha');
    await sleep(450);
    await page.click('#eno-go-auth');
    await page.waitForSelector('#eno-signup-form');
    await sleep(400);

    await page.fill('#s-name', 'Dra. Sofia Mendes');
    await page.fill('#s-email', sofiaEmail);
    await page.fill('#s-crp', 'CRP 06/312450');
    await page.fill('#s-pwd', sofiaPass);
    await sleep(400);
    await page.click('#eno-signup-form button[type="submit"]');
    await page.waitForSelector('#otp-0');
    await sleep(600);

    // Mask outbox preview visually before screenshot/recording? Use paste cleanly
    const code = await fetchLatestCode(sofiaEmail);
    await page.click('#otp-0');
    await page.evaluate((c) => {
      const el = document.querySelector('#otp-0');
      const dt = new DataTransfer();
      dt.setData('text/plain', c);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, code);
    await sleep(550);
    await page.click('#eno-verify-form button[type="submit"]');
    await page.waitForSelector('#chk-outcome');
    await sleep(550);

    // Approve simulated checkout (Ambo + Minne + Etha)
    await page.selectOption('#chk-outcome', 'approved');
    await page.click('#eno-checkout-submit');
    await page.waitForSelector('text=Aprovado (simulação)');
    await sleep(700);
    await page.click('button:has-text("Ir para o Portal")');
    await page.waitForSelector('text=Seus produtos prontos para uso');
    await sleep(750);

    // Capture Sofia's real slug from Portal
    sofiaSlug = await page.evaluate(() => {
      const m = document.body.innerText.match(/\?pro=([a-z0-9-]+)/);
      return m ? m[1] : '';
    });
    if (!sofiaSlug) throw new Error('Could not read Sofia slug from Portal');

    // Simulate logout + closing session and logging back in cleanly (persisted on server!)
    await page.click('#eno-logout');
    await page.waitForSelector('#eno-login-form');
    await sleep(500);
    await page.fill('#l-email', sofiaEmail);
    await page.fill('#l-pwd', sofiaPass);
    await page.click('#eno-login-form button[type="submit"]');
    await page.waitForSelector('text=Seus produtos prontos para uso');
    await sleep(700);
    await page.screenshot({ path: path.join(SHOTS_DIR, '01-sofia-portal-persisted.png') });
    report.screenshots.push('shots/01-sofia-portal-persisted.png');

    const v1Path = await page.video().path();
    await ctx1.close();
    const mp4v1 = transcodeMp4(v1Path, '01-real-user-email-auth-checkout-portal-1x.mp4');
    report.videos.push({ id: 'video_1_real_auth_checkout_portal', path: mp4v1, speed: '1x', viewport: '1440x900' });

    // Brand-new isolated browser context ("outro aparelho") verifies server persistence!
    const otherDeviceCtx = await chBrowser.newContext({ viewport: { width: 1440, height: 900 } });
    await attachPortRemap(otherDeviceCtx);
    const otherPage = await otherDeviceCtx.newPage();
    await otherPage.goto(`${URLS.enomera}/portal`);
    await otherPage.waitForSelector('#eno-login-form');
    await otherPage.fill('#l-email', sofiaEmail);
    await otherPage.fill('#l-pwd', sofiaPass);
    await otherPage.click('#eno-login-form button[type="submit"]');
    await otherPage.waitForSelector('text=Seus produtos prontos para uso');
    const otherDeviceHasAll3 = await otherPage.evaluate(() =>
      document.body.innerText.includes('Ambo · active') &&
      document.body.innerText.includes('Minne · active') &&
      document.body.innerText.includes('Etha ·')
    );
    if (!otherDeviceHasAll3) throw new Error('Other device did not see all 3 active entitlements!');
    await otherDeviceCtx.close();

    report.journeys.enomera_portal_cross_device = { passed: true, slug: sofiaSlug, crossDevicePersisted: true };
    console.log('Video 1 + Enomera Cross-Device OK:', sofiaSlug);
  }

  // =========================================================================
  // VIDEO 2 (1x real speed):
  // Etha Draft -> Approve -> Publish -> Multi-tenant Public Site (?site=sofiaSlug)
  // -> Ambo Default `/` First Request -> Minne Default `/` Confirm -> Patient Reschedule -> Minne Approve
  // =========================================================================
  {
    const ctx2 = await chBrowser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: VIDEOS_DIR, size: { width: 1440, height: 900 } },
    });
    await attachPortRemap(ctx2);
    const page = await ctx2.newPage();
    const patientEmail = `paciente.sofia.${ts}@exemplo.invalid`;
    const sofiaHeadline = 'Escuta clínica singular com Dra. Sofia Mendes.';

    // 1. Etha: login as Dra. Sofia, save draft, approve, publish!
    await page.goto(`${URLS.etha}/?modo=ao-vivo`);
    await page.waitForSelector('#el-login');
    await page.fill('#el-login input[name="email"]', sofiaEmail);
    await page.fill('#el-login input[name="password"]', sofiaPass);
    await page.click('#el-login button[type="submit"]');
    await page.waitForSelector('#el-headline');
    await sleep(500);

    await page.fill('#el-headline', sofiaHeadline);
    await page.fill('#el-subheadline', 'Atendimento online e presencial em Campinas, SP.');
    await sleep(450);
    await page.click('button[data-stage="draft"]');
    await page.waitForSelector('#el-headline-badge:has-text("rascunho não publicado")');
    await sleep(500);
    await page.click('#el-approve');
    await page.waitForSelector('[role="status"]:has-text("Versão aprovada")');
    await sleep(450);
    await page.click('#el-publish');
    await page.waitForSelector('#el-headline-badge:has-text("Publicado em homologação")');
    await sleep(600);

    // 2. Open Sofia's live published site (?site=sofiaSlug) -> verify Sofia's identity & CTA!
    await page.goto(`${URLS.helena}/?site=${encodeURIComponent(sofiaSlug)}`);
    await page.waitForSelector(`h1:has-text("${sofiaHeadline}")`);
    await page.waitForSelector('header.identity:has-text("Dra. Sofia Mendes")');
    await sleep(750);
    await page.screenshot({ path: path.join(SHOTS_DIR, '02-sofia-published-site.png') });
    report.screenshots.push('shots/02-sofia-published-site.png');

    // 3. Click CTA -> lands on Ambo default `/` (REAL backend!) with ?pro=sofiaSlug&origem=etha!
    await page.click('a.request-link');
    await page.waitForURL(new RegExp(`127\\.0\\.0\\.1:3001/\\?pro=${sofiaSlug}`));
    await page.waitForSelector('.ambo-origin-banner');
    await sleep(650);

    await page.click('.ambo-lens-opt:has-text("Presencial")');
    await sleep(350);
    await page.click('.ambo-lens-opt:has-text("Online")');
    await sleep(350);
    await page.fill('input[placeholder*="Marina"]', 'Camila Paciente Real');
    await page.fill('input[placeholder*="marina@"]', patientEmail);
    await page.fill('input[placeholder*="(11)"]', '(19) 99123-4567');
    await sleep(400);
    await page.click('button[type="submit"]:has-text("Enviar solicitação")');
    await page.waitForSelector('text=Preferência enviada');
    await sleep(700);

    // 4. Open Minne DEFAULT `/` (NO ?modo=ao-vivo needed!) -> Login Dra. Sofia -> Confirm request!
    await page.goto(URLS.minne);
    await page.waitForSelector('input[aria-label="E-mail profissional"]');
    await page.fill('input[aria-label="E-mail profissional"]', sofiaEmail);
    await page.fill('input[aria-label="Senha profissional"]', sofiaPass);
    await page.click('button[type="submit"]:has-text("Entrar no Minne")');
    await page.waitForSelector('button:has-text("Solicitações")');
    await sleep(500);
    await page.click('button:has-text("Solicitações")');
    await page.waitForSelector('text=Camila Paciente Real');
    await sleep(550);
    await page.click('button:has-text("Confirmar horário na agenda")');
    await page.waitForSelector('text=Consulta confirmada para Camila Paciente Real');
    await sleep(750);

    // 5. Patient checks Ambo Área do paciente -> requests reschedule -> Sofia approves in Minne!
    await page.goto(`${URLS.ambo}/?pro=${encodeURIComponent(sofiaSlug)}&origem=etha&aba=acesso`);
    await page.waitForSelector('input[placeholder*="E-mail usado"]');
    await page.fill('input[placeholder*="E-mail usado"]', patientEmail);
    await page.click('button:has-text("Gerar código de acesso")');
    await page.waitForSelector('.ambo-otp-slot');
    const patCode = await fetchLatestCode(patientEmail);
    await page.locator('.ambo-otp-slot').first().click();
    await page.evaluate((c) => {
      const el = document.querySelector('.ambo-otp-slot');
      const dt = new DataTransfer();
      dt.setData('text/plain', c);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, patCode);
    await sleep(450);
    await page.click('button:has-text("Entrar na área do paciente")');
    await page.waitForSelector('text=Consulta confirmada');
    await sleep(650);
    await page.click('button:has-text("Solicitar alteração")');
    await page.waitForSelector('text=Alteração solicitada · original vigente');
    await sleep(700);

    await page.goto(URLS.minne);
    await page.waitForSelector('button:has-text("Agenda")');
    await page.click('button:has-text("Agenda")');
    await page.waitForSelector('text=HORÁRIO VIGENTE ATÉ APROVAÇÃO');
    await sleep(700);
    await page.click('button:has-text("Aprovar mudança")');
    await page.waitForSelector('text=Remarcação aprovada nos dois lados');
    await sleep(750);
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-minne-sofia-reschedule-approved.png') });
    report.screenshots.push('shots/03-minne-sofia-reschedule-approved.png');

    const v2Path = await page.video().path();
    await ctx2.close();
    const mp4v2 = transcodeMp4(v2Path, '02-real-user-etha-publish-ambo-minne-reschedule-1x.mp4');
    report.videos.push({ id: 'video_2_etha_ambo_minne_reschedule', path: mp4v2, speed: '1x', viewport: '1440x900' });

    report.journeys.etha_ambo_minne_e2e = { passed: true, multiTenantPublished: true, amboDefaultLive: true, minneDefaultLive: true };
    console.log('Video 2 + Etha -> Public Site -> Ambo -> Minne OK');
  }

  // =========================================================================
  // CROSS-ACCOUNT ISOLATION + SERVER RESTART PERSISTENCE
  // =========================================================================
  {
    // Sign up Account B (Dr. Tiago) via API, verify email, activate Minne, verify ZERO visibility into Dra. Sofia's patients/notes
    const tiagoSignup = await (await fetch(`${URLS.enomera}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Dr. Tiago Isolado', email: tiagoEmail, password: tiagoPass, crpOrCrm: 'CRM-SP 998811', specialty: 'Psiquiatria' }),
    })).json();
    const tiagoTok = tiagoSignup.sessionToken;
    const tiagoCode = await fetchLatestCode(tiagoEmail);
    const tiagoVer = await fetch(`${URLS.enomera}/api/v1/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tiagoTok}` },
      body: JSON.stringify({ email: tiagoEmail, code: tiagoCode }),
    });
    if (!tiagoVer.ok) throw new Error(`Tiago email verify failed: ${tiagoVer.status}`);
    const tiagoOrd = await fetch(`${URLS.enomera}/api/v1/commercial/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tiagoTok}`, 'X-Idempotency-Key': 'tiago_minne_1' },
      body: JSON.stringify({ products: ['minne'], simulatedOutcome: 'approved' }),
    });
    if (!tiagoOrd.ok) throw new Error(`Tiago order failed: ${tiagoOrd.status}`);
    const tiagoWsRes = await fetch(`${URLS.enomera}/api/v1/minne/workspace`, {
      headers: { Authorization: `Bearer ${tiagoTok}` },
    });
    if (!tiagoWsRes.ok) throw new Error(`Tiago workspace failed: ${tiagoWsRes.status}`);
    const tiagoWs = await tiagoWsRes.json();
    if (tiagoWs.patients.length !== 0 || tiagoWs.appointments.length !== 0) {
      throw new Error('Cross-account leak detected for Dr. Tiago!');
    }

    // Restart ALL 5 servers cleanly and verify Dra. Sofia's data + published site survive full restart!
    console.log('Restarting 5-app ecosystem to verify restart persistence...');
    try { execFileSync('taskkill', ['/PID', String(launcher.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    await sleep(1500);
    launcher = startEcosystem();
    await waitEcosystemReady();

    const afterRestartSite = await (await fetch(`${URLS.enomera}/api/v1/public/sites/${encodeURIComponent(sofiaSlug)}`)).json();
    if (afterRestartSite.displayName !== 'Dra. Sofia Mendes') {
      throw new Error('Published site did not survive server restart!');
    }
    const sofiaLoginAfter = await (await fetch(`${URLS.enomera}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: sofiaEmail, password: sofiaPass }),
    })).json();
    const sofiaWsAfter = await (await fetch(`${URLS.enomera}/api/v1/minne/workspace`, {
      headers: { Authorization: `Bearer ${sofiaLoginAfter.sessionToken}` },
    })).json();
    if (sofiaWsAfter.appointments.length < 1 || sofiaWsAfter.patients.length < 1) {
      throw new Error('Appointments/patients did not survive server restart!');
    }
    report.journeys.two_account_isolation_and_restart = {
      passed: true,
      accountBSeesZeroAccountAData: true,
      persistedAcrossFullServerRestart: true,
      persistedAppointmentsCount: sofiaWsAfter.appointments.length,
    };
    console.log('Two-account isolation + Full Server Restart Persistence OK!');
  }

  // =========================================================================
  // DUAL-ENGINE MATRIX (Chromium + WebKit x Desktop 1440 + Mobile 390 x Normal + Reduced)
  // Confirming default `/` of Ambo and Minne load live backend with 0px overflow!
  // =========================================================================
  for (const [engineName, browser] of [['chromium', chBrowser], ['webkit', wkBrowser]]) {
    for (const [vpName, viewport] of [['desktop_1440', { width: 1440, height: 900 }], ['mobile_390', { width: 390, height: 844 }]]) {
      for (const reduced of [false, true]) {
        const key = `${engineName}_${vpName}_${reduced ? 'reduced' : 'normal'}`;
        const ctx = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference' });
        await attachPortRemap(ctx);
        const page = await ctx.newPage();

        await page.goto(URLS.ambo);
        await page.waitForSelector('.ambo-lens-group');
        const amboOverflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

        await page.goto(URLS.minne);
        await page.waitForSelector('input[aria-label="E-mail profissional"]');
        const minneOverflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

        await page.goto(`${URLS.enomera}/checkout`);
        await page.waitForSelector('#eno-bill-seg');
        const enoOverflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

        await ctx.close();
        report.matrix[key] = {
          passed: amboOverflow <= 2 && minneOverflow <= 2 && enoOverflow <= 2,
          overflowPx: { ambo: amboOverflow, minne: minneOverflow, enomera: enoOverflow },
        };
        if (!report.matrix[key].passed) throw new Error(`Overflow failed on ${key}`);
        console.log(`Matrix ${key}: PASS`);
      }
    }
  }

  await chBrowser.close();
  await wkBrowser.close();

  fs.writeFileSync(path.join(ARTIFACT_DIR, 'real-users-report.json'), JSON.stringify(report, null, 2));
  console.log('ALL REAL-USER END-TO-END & DUAL-ENGINE CHECKS PASSED!');
} finally {
  try { execFileSync('taskkill', ['/PID', String(launcher.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
}
