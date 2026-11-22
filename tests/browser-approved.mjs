import { chromium, webkit, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = process.env.ENOMERA_BASE_URL || 'http://127.0.0.1:4319';
if (!base.startsWith('http://127.0.0.1:')) throw new Error('This local outbox proof must not run against remote services.');
const evidence = path.resolve('../../enomera-review/enomera-implementation');
await fs.mkdir(evidence,{recursive:true});
const report=[];
for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await engine.launch({headless:true});
  for (const width of [390,1440]) {
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000},recordVideo:{dir:evidence,size:{width,height:width===390?844:1000}}});
    const page=await context.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    const email=`approved-${name}-${width}-${Date.now()}@exemplo.invalid`;
    const password='SenhaFicticia!2026';
    try {
      await page.goto(`${base}/checkout`);
      await expect(page.getByRole('heading',{name:'O que sua prática precisa agora?'})).toBeVisible();
      await page.getByRole('button',{name:'Continuar com esta combinação',exact:true}).waitFor({state:'visible'});
      await expect(page.getByRole('button',{name:'Continuar com esta combinação',exact:true})).toBeEnabled();
      await page.screenshot({path:path.join(evidence,`${name}-${width}-selection.png`)});
      await page.getByRole('button',{name:'Continuar com esta combinação',exact:true}).click();
      await page.getByLabel('Nome profissional',{exact:true}).fill('Profissional Aprovação');
      await page.getByLabel('E-mail profissional',{exact:true}).fill(email);
      await page.getByLabel('Senha',{exact:true}).fill(password);
      await page.screenshot({path:path.join(evidence,`${name}-${width}-account.png`)});
      await page.getByRole('button',{name:'Criar conta e receber código',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Confirme seu e-mail',exact:true})).toBeVisible();
      const messages=await (await context.request.get(`${base}/api/v1/dev/outbox?recipient=${encodeURIComponent(email)}`)).json();
      const code=messages.messages[0].body_preview.match(/\d{6}/)[0];
      await page.getByLabel('Dígito 1 do código',{exact:true}).fill('000000');
      await page.getByRole('button',{name:'Confirmar e continuar',exact:true}).click();
      await expect(page.getByText('Código incorreto. Confira os 6 dígitos e tente novamente.',{exact:true})).toBeVisible();
      await page.getByLabel('Dígito 1 do código',{exact:true}).fill(code);
      await page.getByRole('button',{name:'Confirmar e continuar',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Revise sua contratação',exact:true})).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading',{name:'Revise sua contratação',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Alterar combinação',exact:true}).click();
      await page.getByRole('checkbox',{name:'Selecionar Minne',exact:true}).uncheck();
      await expect(page.getByRole('button',{name:'Continuar com esta combinação',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'Continuar com esta combinação',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Ambo',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Testar uma recusa na simulação',exact:true}).click();
      await expect(page.getByRole('heading',{name:'A simulação foi recusada',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
      await expect(page.getByRole('button',{name:'Abrir meu portal',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Abrir meu portal',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Seu portal',exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'Abrir Ambo',exact:true})).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button',{name:'Abrir Ambo',exact:true})).toBeVisible();
      await page.screenshot({path:path.join(evidence,`${name}-${width}-portal.png`)});
      const second=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
      const secondPage=await second.newPage();
      await secondPage.goto(`${base}/conta`);
      await secondPage.getByLabel('E-mail profissional',{exact:true}).fill(email);
      await secondPage.getByLabel('Senha',{exact:true}).fill(password);
      await secondPage.getByRole('button',{name:'Entrar e continuar',exact:true}).click();
      await expect(secondPage.getByRole('button',{name:'Abrir Ambo',exact:true})).toBeVisible();
      await secondPage.getByRole('button',{name:'Sair',exact:true}).click();
      await expect(secondPage.getByRole('heading',{name:'Entre na sua conta',exact:true})).toBeVisible();
      await second.close();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      expect(overflow).toBe(false); expect(errors).toEqual([]);
      report.push({engine:name,width,result:'passed',scope:'real local API, SQLite/private files/local outbox; not remote email'});
    } catch(err) {
      await page.screenshot({path:path.join(evidence,`${name}-${width}-failure.png`)});
      report.push({engine:name,width,result:'failed',error:err.message});
      console.error(`${name}/${width}: ${err.message}`);
    } finally { await context.close(); }
  }
  await browser.close();
}
await fs.writeFile(path.join(evidence,'browser-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report.map(({engine,width,result,error})=>({engine,width,result,error})),null,2));
if(report.some(r=>r.result==='failed')) process.exitCode=1;
