import {chromium,webkit,expect} from '@playwright/test';
import fs from 'node:fs/promises';import path from 'node:path';
const apiBase='https://enomera-git-codex-enomera-approved-preview-marcosvmgs-projects.vercel.app';
const minne='https://compasso-app-git-codex-minne-approve-8c6367-marcosvmgs-projects.vercel.app';
const site='https://clara-azevedo-site-git-codex-helena-9838a4-marcosvmgs-projects.vercel.app';
const out=path.resolve('../../enomera-review/remote-approved');await fs.mkdir(out,{recursive:true});const report=[];
async function api(route,token='',body,method=body===undefined?'GET':'POST',key){const r=await fetch(apiBase+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...(key?{'X-Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:r.headers.get('content-type')?.includes('application/json')?await r.json():null};}
const credentials={email:'paulo@consultorio-exemplo.com.br',password:process.env.ENOMERA_DEMO_PASSWORD};
const login=await api('/api/v1/auth/login','',credentials);expect(login.status).toBe(200);const token=login.data.sessionToken;
const foreign=await api('/api/v1/auth/login','',{email:'helena@helenaduartepsi.com.br',password:process.env.ENOMERA_DEMO_PASSWORD});const other=foreign.data.sessionToken;
expect((await api('/api/v1/commercial/orders',token,{products:['ambo','minne','etha'],simulatedOutcome:'approved'},'POST','paulo-preview-qa-suite-v1')).status).toBeLessThan(300);
await api('/api/v1/professional/availability',token,{rules:Array.from({length:7},(_,weekday)=>({weekday,startTime:'09:00',endTime:'18:00',modality:'both'}))},'PUT');
const version=await api('/api/v1/etha/project/editor',token,{content:{displayName:'Dr. Paulo Mendes',headline:'Um espaço de cuidado com a sua saúde mental.',subheadline:'Atendimento de psiquiatria. Perfil fictício de homologação.',photoAssetId:null,ctaLabel:'Agendar consulta'}});
expect(version.status).toBe(201);expect((await api('/api/v1/etha/project/publish-staging',token,{versionId:version.data.versionId,ctaMode:'ambo'})).status).toBe(200);
const secondSite=await api('/api/v1/public/sites/paulo-mendes');expect(secondSite.data.amboProfileSlug).toBe('paulo-mendes');expect(secondSite.data.photoUrl).toBeNull();
for(const [engineName,engine]of[['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({headless:true});
 for(const width of [1440,390]){
  const id=`minne-${engineName}-${width}`;const run=Date.now().toString(36);const names=['Marina Costa '+run,'Lucas Almeida '+run];
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:width===390?'reduce':'no-preference',recordVideo:{dir:out}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   for(let i=0;i<2;i++)expect((await api('/api/v1/ambo/public/paulo-mendes/requests','',{patientName:names[i],patientEmail:`minne-${run}-${i}@exemplo.invalid`,modality:'online',preferences:{days:[],periods:[]}},'POST',`minne-remote-${run}-${i}`)).status).toBe(201);
   const handoff=await api('/api/v1/auth/handoff',token,{targetOrigin:minne,returnPath:'/?aba=requests'});expect(handoff.status).toBe(200);await page.goto(minne+'/?aba=requests&handoff='+encodeURIComponent(handoff.data.handoffCode));await expect(page.getByRole('heading',{name:'Solicitações',exact:true})).toBeVisible();
   await page.screenshot({path:path.join(out,id+'-queue.png')});
   for(let i=0;i<2;i++){
    await page.getByRole('button',{name:new RegExp(names[i]+'.*pendente')}).click();await page.getByRole('radio').first().click();await page.getByRole('button',{name:'Confirmar horário',exact:true}).click();await expect(page.getByRole('button',{name:'Ver na agenda',exact:true})).toBeVisible();await page.getByRole('button',{name:'Ver na agenda',exact:true}).click();await expect(page.getByTestId('agenda-date')).toBeVisible();await page.getByRole('button',{name:'Voltar às solicitações',exact:true}).click();if(width===390&&i===0)await page.getByRole('button',{name:'Voltar à lista',exact:true}).click();
   }
   await expect(page.getByText('Todas as solicitações confirmadas',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Todas as solicitações confirmadas',{exact:true})).toBeVisible();
   const workspace=await api('/api/v1/minne/workspace',token);expect(workspace.data.requests.filter(r=>r.status==='preference_sent')).toHaveLength(0);const appointment=workspace.data.appointments.find(a=>a.patient_name===names[0]);expect(appointment).toBeTruthy();
   const draft=await api('/api/v1/minne/notes/draft',token,{patientId:appointment.patient_id,blocks:[{id:'demo',type:'paragraph',text:'Registro fictício de homologação. Nenhum dado de paciente real.'}]});expect(draft.status).toBe(200);
   const file=await api(`/api/v1/minne/notes/${draft.data.noteId}/attachments`,token,{originalName:'documento-ficticio.pdf',contentBase64:Buffer.from('%PDF-1.4\nArquivo ficticio de homologacao.\n%%EOF').toString('base64')});expect(file.status).toBe(201);
   const filePath='/api/v1/files/'+file.data.file.id;expect((await api(filePath,token)).status).toBe(200);expect([403,404]).toContain((await api(filePath,other)).status);expect([401,403]).toContain((await api(filePath)).status);expect([403,404]).toContain((await api(`/api/v1/minne/patients/${appointment.patient_id}/notes`,other)).status);
   await page.goto(minne+'/?aba=notes');await page.getByLabel('Selecionar paciente do prontuário',{exact:true}).selectOption(appointment.patient_id);await expect(page.getByRole('textbox',{name:'Evolução do atendimento'})).toHaveValue('Registro fictício de homologação. Nenhum dado de paciente real.');await page.getByRole('textbox',{name:'Evolução do atendimento'}).fill('Registro fictício atualizado e persistido na homologação.');await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();await expect(page.getByText('Alterações salvas',{exact:true})).toBeVisible();await page.reload();await page.getByLabel('Selecionar paciente do prontuário',{exact:true}).selectOption(appointment.patient_id);await expect(page.getByRole('textbox',{name:'Evolução do atendimento'})).toHaveValue('Registro fictício atualizado e persistido na homologação.');
   await page.goto(site+'/?site=paulo-mendes');await expect(page.getByRole('heading',{name:/Um espaço de cuidado/}).first()).toBeVisible();await expect(page.locator('a[href*="pro=paulo-mendes"]').first()).toBeVisible();expect(await page.locator('img[src*="helena-duarte"]').count()).toBe(0);await page.screenshot({path:path.join(out,id+'-second-site.png')});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);expect(errors).toEqual([]);report.push({id,result:'passed',scope:'remote fictitious Paulo account, simulated zero-charge activation, real handoff, two requests to zero, agenda, note and private Blob attachment; second professional CTA and no borrowed photo'});
  }catch(e){await page.screenshot({path:path.join(out,id+'-failure.png'),fullPage:true}).catch(()=>{});report.push({id,result:'failed',error:e.message});console.error(id+': '+e.message);break;}
  finally{const video=page.video();await context.close();if(video)await fs.copyFile(await video.path(),path.join(out,id+'-journey.webm'));}
 }
 await browser.close();
}
await api('/api/v1/auth/logout',token,{});await api('/api/v1/auth/logout',other,{});await fs.writeFile(path.join(out,'minne-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.some(r=>r.result==='failed'))process.exitCode=1;
