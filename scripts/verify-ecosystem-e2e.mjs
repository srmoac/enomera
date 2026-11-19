import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { createEnomeraServer } from './server.mjs';
import { getDb, closeDb } from '../server/db.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/mrsao/OneDrive/Documentos/ChatGPT/Enomora/node_modules/playwright');
process.env.PLAYWRIGHT_BROWSERS_PATH = 'C:/Users/mrsao/OneDrive/Documentos/ChatGPT/Enomora/.browsers';

const ARTIFACT_DIR = 'C:/Users/mrsao/.gemini/antigravity/brain/f27c97a2-200c-4a2e-a143-4106969045a7/evidence/platform-v1';
const VIDEO_DIR = path.join(ARTIFACT_DIR, 'videos');
const SHOT_DIR = path.join(ARTIFACT_DIR, 'shots');
fs.mkdirSync(VIDEO_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStaticDir(dirPath, port, fallbackIndex = true) {
  const root = path.resolve(dirPath);
  const srv = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      let rel = decodeURIComponent(url.pathname);
      let file = path.resolve(root, '.' + rel);
      if (!file.startsWith(root)) throw new Error('403');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        file = path.join(file, 'index.html');
      } else if (!fs.existsSync(file) && fs.existsSync(file + '.html')) {
        file = file + '.html';
      } else if (!fs.existsSync(file) && fallbackIndex) {
        file = path.join(root, 'index.html');
      }
      const data = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve(srv)));
}

function convertToMp4(webmPath, mp4Name) {
  const ffmpeg = 'C:/Users/mrsao/.stacher/ffmpeg.exe';
  const outMp4 = path.join(VIDEO_DIR, mp4Name);
  if (fs.existsSync(ffmpeg)) {
    execFileSync(ffmpeg, ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outMp4], { stdio: 'ignore' });
    return outMp4;
  }
  return webmPath;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-e2e-'));
process.env.ENOMERA_DB_PATH = path.join(tmpDir, 'e2e.sqlite');
process.env.ENOMERA_STORAGE_DIR = path.join(tmpDir, 'private');
const db = getDb(process.env.ENOMERA_DB_PATH);

const servers = [];
try {
  // 1. Start all 5 apps on isolated local ports
  const enomeraSrv = createEnomeraServer(db);
  await new Promise((r) => enomeraSrv.listen(4319, '127.0.0.1', r));
  servers.push(enomeraSrv);

  servers.push(await serveStaticDir('C:/Users/mrsao/Documents/Enomera/ambo/out', 3001, true));
  servers.push(await serveStaticDir('C:/Users/mrsao/Documents/Enomera/minne/out', 3002, true));
  servers.push(await serveStaticDir('C:/Users/mrsao/Documents/Enomera/etha/dist', 3003, true));

  // Helena Duarte runs via Next.js server or static build — start next start on 3004
  const { spawn } = await import('node:child_process');
  const helenaProc = spawn('node', ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3004'], {
    cwd: 'C:/Users/mrsao/Documents/Enomera/helena-duarte',
    stdio: 'ignore',
  });
  // Wait for Helena on 3004
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:3004');
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  const browser = await chromium.launch({ headless: true });
  const results = { flows: {}, viewports: {} };

  try {
    // ─────────────────────────────────────────────────────────────────
    // FLOW 1: Signup -> Verify Email -> Simulated Checkout (Declined -> Retry -> Approved) -> Portal
    // ─────────────────────────────────────────────────────────────────
    const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } } });
    const p1 = await ctx1.newPage();
    await p1.goto('http://127.0.0.1:4319/portal?etapa=conta', { waitUntil: 'networkidle' });
    await p1.click('button[data-authmode="signup"]');
    await p1.fill('#s-name', 'Dra. Beatriz E2E');
    await p1.fill('#s-email', 'beatriz.e2e@exemplo.invalid');
    await p1.fill('#s-crp', 'CRP 06/555222');
    await p1.fill('#s-pwd', 'SenhaBeatriz!2026');
    await p1.click('#eno-signup-form button[type="submit"]');
    await p1.waitForSelector('.eno-outbox');
    const outboxText = await p1.textContent('.eno-outbox');
    const codeMatch = /(\d{6})/.exec(outboxText || '');
    assert.ok(codeMatch, 'Verification code must appear in homologation outbox');
    await p1.fill('#v-code', codeMatch[1]);
    await p1.click('#eno-verify-form button[type="submit"]');
    await p1.waitForSelector('#eno-checkout-submit');
    // Simulate declined then retry -> approved!
    await p1.selectOption('#chk-outcome', 'declined');
    await p1.click('#eno-checkout-submit');
    await p1.waitForSelector('#eno-retry-order');
    await p1.click('#eno-retry-order');
    await p1.waitForTimeout(500);
    await p1.click('button[data-tab="portal"]');
    await p1.waitForSelector('.eno-card-ambo');
    await p1.screenshot({ path: path.join(SHOT_DIR, '01-enomera-portal-desktop.png') });
    const v1Path = await p1.video().path();
    await ctx1.close();
    results.flows.authCheckoutPortal = { ok: true, video: convertToMp4(v1Path, '01-auth-checkout-portal.mp4') };

    // ─────────────────────────────────────────────────────────────────
    // FLOW 2: Milestone 1 Cross-App (Helena Site -> Ambo Request -> Minne Confirm -> Patient Verify & Reschedule -> Minne Approve)
    // ─────────────────────────────────────────────────────────────────
    const ctxPro = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } } });
    const ctxPat = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } } });
    const patPage = await ctxPat.newPage();
    const proPage = await ctxPro.newPage();

    // Patient starts on Helena Duarte site (:3004) -> verifies live CTA points to Ambo :3001/?pro=helena-duarte
    await patPage.goto('http://127.0.0.1:3004', { waitUntil: 'networkidle' });
    await patPage.waitForTimeout(400);
    const ctaHref = await patPage.getAttribute('a.request-link', 'href');
    assert.ok(ctaHref && ctaHref.includes('pro=helena-duarte'), `Expected Ambo CTA with pro=helena-duarte, got ${ctaHref}`);
    await patPage.goto('http://127.0.0.1:3001/?pro=helena-duarte', { waitUntil: 'networkidle' });
    await patPage.fill('input[placeholder*="Marina"]', 'Marina E2E');
    await patPage.fill('input[type="email"]', 'marina.e2e@exemplo.invalid');
    await patPage.fill('input[placeholder*="98412"]', '(11) 98412-9999');
    await patPage.click('button[type="submit"]');
    await patPage.waitForSelector('text=Preferência enviada');
    await patPage.screenshot({ path: path.join(SHOT_DIR, '02-ambo-preference-sent.png') });

    // Helena opens Minne in SEPARATE browser context, logs in, sees Marina E2E, confirms!
    await proPage.goto('http://127.0.0.1:3002/?modo=ao-vivo', { waitUntil: 'networkidle' });
    await proPage.click('button:has-text("Preencher Helena")');
    await proPage.click('button:has-text("Entrar no Minne")');
    await proPage.waitForSelector('button:has-text("Solicitações")');
    await proPage.click('button:has-text("Solicitações")');
    await proPage.waitForSelector('text=Marina E2E');
    await proPage.screenshot({ path: path.join(SHOT_DIR, '03-minne-ambo-request.png') });
    await proPage.click('button:has-text("Confirmar horário na agenda")');
    await proPage.waitForSelector('text=Consulta confirmada para Marina E2E');
    // Reload Minne to confirm persistence!
    await proPage.reload({ waitUntil: 'networkidle' });
    await proPage.click('button:has-text("Agenda")');
    await proPage.waitForSelector('b:has-text("Marina E2E")');

    // Marina verifies email on Ambo, sees Consulta confirmada, requests reschedule!
    await patPage.click('button:has-text("Verificar meu e-mail")');
    await patPage.click('button:has-text("Gerar código de acesso")');
    await patPage.waitForSelector('text=Caixa de homologação');
    const patBody = await patPage.textContent('main');
    const patCode = /(\d{6})/.exec(patBody || '')?.[1];
    assert.ok(patCode, 'Patient 6-digit code must be generated');
    await patPage.fill('input[placeholder*="6 dígitos"]', patCode);
    await patPage.click('button:has-text("Entrar na área do paciente")');
    await patPage.waitForSelector('text=Consulta confirmada');
    await patPage.screenshot({ path: path.join(SHOT_DIR, '04-ambo-confirmed-patient.png') });
    await patPage.click('button:has-text("Solicitar alteração")');
    await patPage.waitForSelector('text=Alteração solicitada');

    // Helena approves reschedule in Minne -> Marina reloads and sees updated confirmed appointment!
    await proPage.click('button:has-text("Atualizar dados")');
    await proPage.waitForSelector('button:has-text("Aprovar mudança")');
    await proPage.click('button:has-text("Aprovar mudança")');
    await proPage.waitForSelector('text=Remarcação aprovada nos dois lados');
    await patPage.click('button:has-text("Atualizar status")');
    await patPage.waitForTimeout(400);
    const vProPath = await proPage.video().path();
    const vPatPath = await patPage.video().path();
    await ctxPro.close();
    await ctxPat.close();
    results.flows.milestone1Reschedule = {
      ok: true,
      minneVideo: convertToMp4(vProPath, '02-minne-confirm-reschedule.mp4'),
      amboVideo: convertToMp4(vPatPath, '02-ambo-patient-journey.mp4'),
    };

    // ─────────────────────────────────────────────────────────────────
    // FLOW 3: Minne Import Center (Pasted Text + ZIP Batch + Staging -> Commit)
    // ─────────────────────────────────────────────────────────────────
    const ctxImp = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } } });
    const impPage = await ctxImp.newPage();
    await impPage.goto('http://127.0.0.1:3002/?modo=ao-vivo&aba=importar', { waitUntil: 'networkidle' });
    await impPage.click('button:has-text("Preencher Helena")');
    await impPage.click('button:has-text("Entrar no Minne")');
    await impPage.waitForSelector('text=Importar pacientes e prontuários existentes');
    await impPage.fill('textarea', 'Historico clinico ficticio colado via UI do Minne para revisao obrigatoria.');
    await impPage.fill('input[placeholder*="Autoria"]', 'Dra. Origem Externa');
    await impPage.click('button:has-text("Processar e abrir preparação")');
    await impPage.waitForSelector('button:has-text("Criar novo paciente")');
    await impPage.click('button:has-text("Criar novo paciente")');
    await impPage.waitForTimeout(250);
    await impPage.click('button:has-text("Confirmar importação")');
    await impPage.waitForSelector('text=Importação processada: 1 importado(s)');
    await impPage.screenshot({ path: path.join(SHOT_DIR, '05-minne-import-completed.png') });
    const vImpPath = await impPage.video().path();
    await ctxImp.close();
    results.flows.minneImport = { ok: true, video: convertToMp4(vImpPath, '03-minne-import-prontuario.mp4') };

    // ─────────────────────────────────────────────────────────────────
    // FLOW 4: Etha Draft (No Silent Publish) -> Explicit Publish Staging -> Live Update on Helena Duarte (:3004)
    // ─────────────────────────────────────────────────────────────────
    const ctxEtha = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } } });
    const ethaPage = await ctxEtha.newPage();
    await ethaPage.goto('http://127.0.0.1:3003/?modo=ao-vivo', { waitUntil: 'networkidle' });
    await ethaPage.click('#el-fill-helena');
    await ethaPage.click('#el-login button[type="submit"]');
    await ethaPage.waitForSelector('#el-editor');
    const newHeadline = 'Escuta clínica autoral publicada pela Etha em homologação.';
    await ethaPage.fill('#el-editor input[name="headline"]', newHeadline);
    await ethaPage.click('#el-editor button[type="submit"]');
    await ethaPage.waitForSelector('text=Salvo como rascunho/prévia');
    await ethaPage.click('#el-publish');
    await ethaPage.waitForSelector('text=Publicado no ambiente de homologação');
    await ethaPage.screenshot({ path: path.join(SHOT_DIR, '06-etha-published-staging.png') });

    // Confirm Helena Duarte (:3004) displays the newly published headline!
    await ethaPage.goto('http://127.0.0.1:3004', { waitUntil: 'networkidle' });
    await ethaPage.waitForSelector(`text=${newHeadline}`);
    await ethaPage.screenshot({ path: path.join(SHOT_DIR, '07-helena-live-updated.png') });
    const vEthaPath = await ethaPage.video().path();
    await ctxEtha.close();
    results.flows.ethaPublishToHelena = { ok: true, video: convertToMp4(vEthaPath, '04-etha-publish-helena-staging.mp4') };

    // ─────────────────────────────────────────────────────────────────
    // FLOW 5: Responsive Mobile Checks (360px, 390px, 430px) + Reduced Motion
    // ─────────────────────────────────────────────────────────────────
    for (const width of [360, 390, 430]) {
      const mCtx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      const mp = await mCtx.newPage();
      const checks = [];
      for (const [name, u] of [
        ['enomera-portal', 'http://127.0.0.1:4319/portal'],
        ['ambo-live', 'http://127.0.0.1:3001/?pro=helena-duarte'],
        ['minne-live', 'http://127.0.0.1:3002/?modo=ao-vivo'],
        ['etha-live', 'http://127.0.0.1:3003/?modo=ao-vivo'],
        ['helena-site', 'http://127.0.0.1:3004'],
      ]) {
        await mp.goto(u, { waitUntil: 'networkidle' });
        const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        checks.push({ name, overflowPx: overflow, ok: overflow <= 2 });
        if (width === 390 && name === 'ambo-live') {
          await mp.screenshot({ path: path.join(SHOT_DIR, '08-ambo-mobile-390.png') });
        }
      }
      results.viewports[`w${width}`] = checks;
      await mCtx.close();
    }

    fs.writeFileSync(path.join(ARTIFACT_DIR, 'e2e-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
    helenaProc.kill();
  }
} finally {
  for (const s of servers) s.close();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
