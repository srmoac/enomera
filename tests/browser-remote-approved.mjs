import {chromium,webkit,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const core='https://enomera-git-codex-enomera-approved-preview-marcosvmgs-projects.vercel.app';
const ambo='https://lotus-app-git-codex-ambo-approved-preview-marcosvmgs-projects.vercel.app';
const site='https://clara-azevedo-site-git-codex-helena-9838a4-marcosvmgs-projects.vercel.app';
const out=path.resolve('../../enomera-review/remote-approved');await fs.mkdir(out,{recursive:true});
const report=[];
for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]].filter(([name])=>!process.env.QA_ENGINE || name===process.env.QA_ENGINE)){
 const browser=await engine.launch({headless:true});
 for(const width of [390,1440].filter(value=>!process.env.QA_WIDTH || String(value)===process.env.QA_WIDTH)){
  const id=`${engineName}-${width}`;const context=await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:width===1440?'reduce':'no-preference',recordVideo:{dir:out,size:{width,height:width===390?844:1000}}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let popup;
  try{
   await page.goto(core+'/conta');await page.getByLabel('E-mail profissional',{exact:true}).fill('helena@helenaduartepsi.com.br');await page.getByLabel('Senha',{exact:true}).fill('HelenaDemo!2026');await page.getByRole('button',{name:'Entrar e continuar',exact:true}).click();await expect(page.getByRole('heading',{name:'Seu portal',exact:true})).toBeVisible();
   await page.screenshot({path:path.join(out,id+'-portal.png')});
   const ethaPopup=page.waitForEvent('popup');await page.getByRole('button',{name:'Abrir Etha',exact:true}).click();popup=await ethaPopup;
   await expect(popup.getByRole('heading',{name:'Conte sobre a sua prática.',exact:true})).toBeVisible({timeout:15000}).catch(async()=>{await expect(popup.locator('#el-workspace-heading')).toBeVisible({timeout:15000});});
   await popup.goto(new URL('/painel',popup.url()).href);await expect(popup.locator('#el-headline')).toBeVisible();await expect(popup.locator('.etha-photo').first()).toBeVisible();
   await popup.locator('#el-headline').fill('Um espaço de escuta para a sua história.');
   if(width===390){await popup.locator('#el-preview-tab').click();await expect(popup.locator('#el-pv-head')).toContainText('a sua história.');await popup.locator('#el-edit-tab').click();await expect(popup.locator('#el-headline')).toHaveValue('Um espaço de escuta para a sua história.');}
   await popup.getByRole('button',{name:'Salvar rascunho',exact:true}).click();await expect(popup.locator('#el-save-status')).toContainText(/salvo/i);
   await popup.screenshot({path:path.join(out,id+'-etha-editor.png'),fullPage:true});
   await popup.getByRole('button',{name:'Revisar publicação',exact:true}).click();await popup.getByRole('button',{name:'Aprovar esta versão',exact:true}).click();await expect(popup.getByRole('button',{name:'Publicar alterações',exact:true})).toBeEnabled();await popup.getByRole('button',{name:'Publicar alterações',exact:true}).click();
   await expect(popup.getByText(/publicad/i).first()).toBeVisible();
   const publicPage=await context.newPage();await publicPage.goto(site+'/?site=helena-duarte');await expect(publicPage.getByRole('heading',{name:/Um espaço de escuta/}).first()).toBeVisible();
   await expect.poll(()=>publicPage.locator('img[src*="/public-sites/helena-duarte/photo/"]').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
   await expect(publicPage.getByText('Atendimento online e presencial em São Paulo. Perfil fictício para apresentação.',{exact:true})).toBeAttached();
   const imageBox=await publicPage.locator('.portrait[data-published-photo=true] img').boundingBox();expect(imageBox.height).toBeGreaterThan(imageBox.width);
   const link=publicPage.locator('a[href*="pro=helena-duarte"]').first();await expect(link).toBeVisible();await publicPage.screenshot({path:path.join(out,id+'-published.png')});
   await publicPage.goto(ambo+'/?pro=helena-duarte');await expect(publicPage.getByRole('heading',{name:'Helena Duarte',exact:true})).toBeVisible();await expect(publicPage.locator('.ambo-approved-portrait')).toBeVisible();
   await publicPage.getByRole('button',{name:'Solicitar primeira consulta',exact:true}).click();await publicPage.getByRole('radio',{name:'Presencial',exact:true}).check();await publicPage.getByRole('radio',{name:'Online',exact:true}).check();await publicPage.getByRole('button',{name:'Continuar',exact:true}).click();
   await publicPage.getByLabel('Nome completo',{exact:true}).fill('Paciente fictício de apresentação');await publicPage.getByLabel('E-mail para confirmação',{exact:true}).fill(`remote-browser-${id}-${Date.now()}@exemplo.invalid`);await publicPage.getByRole('button',{name:'Revisar solicitação',exact:true}).click();await publicPage.screenshot({path:path.join(out,id+'-ambo-review.png')});
   await publicPage.getByRole('button',{name:'Enviar solicitação',exact:true}).click();await expect(publicPage.getByTestId('ambo-first-request-receipt')).toBeVisible();
   for(const tab of [page,popup,publicPage])expect(await tab.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
   expect(errors).toEqual([]);report.push({id,result:'passed',scope:'remote existing demo account login, actual handoff, Etha draft/publish/photo, public site, Ambo persisted request. Email verification blocked by missing provider.'});
  }catch(e){await (popup||page).screenshot({path:path.join(out,id+'-failure.png'),fullPage:true}).catch(()=>{});report.push({id,result:'failed',error:e.message});console.error(id+': '+e.message);}
  finally{const videos=await Promise.all(context.pages().map(p=>p.video()));await context.close();for(let i=0;i<videos.length;i++){const videoPath=await videos[i]?.path();if(videoPath)await fs.copyFile(videoPath,path.join(out,id+'-passage-'+i+'.webm'));}}
 }
 await browser.close();
}
await fs.writeFile(path.join(out,process.env.QA_ENGINE?'browser-refinement-report.json':'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.some(r=>r.result==='failed'))process.exitCode=1;
