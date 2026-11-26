import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const base='https://enomera-git-codex-enomera-approved-preview-marcosvmgs-projects.vercel.app';
const evidence=path.resolve('../../enomera-review/remote-approved');
await fs.mkdir(evidence,{recursive:true});
const report={environment:base,realRemote:true,accounts:'existing fictitious seeded professionals; not fresh email verification',checks:[]};
const call=async(route,method='GET',body=null,token=null)=>{
 const r=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
 const json=r.headers.get('content-type')?.includes('application/json')?await r.json():null;
 return {status:r.status,data:json,bytes:json?null:Buffer.from(await r.arrayBuffer())};
};
const check=(name,actual,expected)=>{assert.equal(actual,expected,name);report.checks.push({name,result:actual});};
const login=async(email,password)=>{const r=await call('/api/v1/auth/login','POST',{email,password});check('login fictitious professional',r.status,200);return r.data.sessionToken;};
try {
 const helena=await login('helena@helenaduartepsi.com.br',process.env.ENOMERA_DEMO_PASSWORD);
 const paulo=await login('paulo@consultorio-exemplo.com.br',process.env.ENOMERA_DEMO_PASSWORD);
 const me=await call('/api/v1/auth/me','GET',null,helena);check('correct Helena account',me.data.account.slug,'helena-duarte');
 const portrait=await fs.readFile('../lotus-app/public/ambo/approved-helena-portrait.png');
 const body={originalName:'helena-retrato-ficticio-autorizado.png',contentBase64:portrait.toString('base64')};
 const profilePhoto=await call('/api/v1/professional/profile/photo','POST',body,helena);check('real Blob professional photo upload',profilePhoto.status,200);
 const publicProfile=await call('/api/v1/ambo/public/helena-duarte');
 const publicPhoto=await call(publicProfile.data.professional.photoUrl);check('current professional photo mediated read',publicPhoto.status,200);assert.deepEqual(publicPhoto.bytes,portrait);
 const photo=await call('/api/v1/etha/project/photo','POST',body,helena);check('real Blob private Etha photo upload',photo.status,200);
 check('anonymous private photo denied',(await call(photo.data.photoUrl)).status,401);
 check('other account private photo denied',(await call(photo.data.photoUrl,'GET',null,paulo)).status,403);
 const owned=await call(photo.data.photoUrl,'GET',null,helena);check('owner private photo read',owned.status,200);assert.deepEqual(owned.bytes,portrait);
 const content={displayName:'Helena Duarte',headline:'Um espaço de escuta para a sua história.',subheadline:'Psicologia para adultos e adolescentes.',about:'Atendimento online e presencial em São Paulo. Perfil fictício para apresentação.',ctaLabel:'Agendar consulta',photoAssetId:photo.data.photoAssetId};
 await call('/api/v1/etha/project/briefing','PUT',{briefing:{approach:'Escuta ética para adultos e adolescentes.',photosConfirmed:true,photoAssetId:photo.data.photoAssetId},briefingStep:4},helena);
 const draft=await call('/api/v1/etha/project/editor','POST',{stage:'preview',content},helena);check('persist Etha version',draft.status,201);
 check('explicit version approval',(await call('/api/v1/etha/project/approve','POST',{versionId:draft.data.versionId},helena)).status,200);
 check('explicit publication',(await call('/api/v1/etha/project/publish-staging','POST',{versionId:draft.data.versionId,ctaMode:'ambo'},helena)).status,200);
 const site=await call('/api/v1/public/sites/helena-duarte');check('published snapshot title',site.data.headline,content.headline);check('published CTA account',site.data.amboProfileSlug,'helena-duarte');
 const publishedPhoto=await call(site.data.photoUrl);check('published version photo mediated read',publishedPhoto.status,200);assert.deepEqual(publishedPhoto.bytes,portrait);
 await call('/api/v1/etha/project/editor','POST',{content:{...content,headline:'Rascunho de teste ainda não publicado',photoAssetId:null}},helena);
 const unchanged=await call('/api/v1/public/sites/helena-duarte');check('draft does not change published title',unchanged.data.headline,content.headline);check('draft photo removal does not change published snapshot',unchanged.data.photoAssetId,photo.data.photoAssetId);
 await call('/api/v1/etha/project/editor','POST',{content},helena);
 const freshSession=await login('helena@helenaduartepsi.com.br',process.env.ENOMERA_DEMO_PASSWORD);
 const reloaded=await call('/api/v1/etha/project','GET',null,freshSession);check('project readable after new login',reloaded.status,200);
 check('private file readable after new login',(await call(photo.data.photoUrl,'GET',null,freshSession)).status,200);
 check('logout',(await call('/api/v1/auth/logout','POST',{},freshSession)).status,200);
 check('revoked session denied',(await call('/api/v1/auth/me','GET',null,freshSession)).status,401);
 await call('/api/v1/auth/logout','POST',{},helena);await call('/api/v1/auth/logout','POST',{},paulo);
 report.result='passed';report.photo={linkedTo:'helena-duarte',publicPhotoVersion:site.data.versionNumber,privateOwnerOnly:true};
} catch(e) {report.result='failed';report.error=e.message;process.exitCode=1;}
await fs.writeFile(path.join(evidence,'infra-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
