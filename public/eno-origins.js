// Endereços dos produtos da Enomera, em um lugar só (home, portal e configuração).
// Regra: os produtos moram no mesmo domínio em que a pessoa está, por caminho
// (/agendamento, /consultorio, /site). Os projetos internos de hospedagem nunca
// aparecem em link visível. Em máquina local cada produto roda em uma porta.
const PATHS = { ambo: 'agendamento', minne: 'consultorio', etha: 'site' };
const LOCAL_PORTS = { ambo: 3001, minne: 3002, etha: 3003, helena: 3004, sites: 3005 };
const WINDOW_KEYS = { ambo: '__ENOMERA_AMBO_URL', minne: '__ENOMERA_MINNE_URL', etha: '__ENOMERA_ETHA_URL', helena: '__ENOMERA_HELENA_URL', sites: '__ENOMERA_SITES_URL' };
// Endereços internos (destino dos rewrites) e de projetos antigos: não podem virar link.
const INTERNAL_HOST = /^(ambo|minne|etha)-enomera[a-z0-9-]*\.vercel\.app$|^(lotus-app|compasso-app|clara-azevedo-site)[a-z0-9-]*\.vercel\.app$/i;
// Site de demonstração (Helena Duarte, dados fictícios): é o site de uma profissional, fora da Enomera.
const HELENA_DEFAULT = 'https://helenaduartepsi.vercel.app';
// Sites publicados pelo Enomera Site: <base>/<slug>. Mesmo padrão do Enomera Site (ENOMERA_SITES_URL).
const SITES_DEFAULT = 'https://sites.enomera.com.br';

const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
function usable(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) && !INTERNAL_HOST.test(u.hostname); } catch { return false; }
}

export function productOrigin(key, loc = globalThis.location, injected = globalThis) {
  const override = clean(injected?.[WINDOW_KEYS[key]]);
  const local = loc && (loc.hostname === '127.0.0.1' || loc.hostname === 'localhost');
  // Os sites publicados moram em enomera-sites.vercel.app (o endereço antigo redireciona para lá):
  // para eles vale o endereço configurado, mesmo com o nome antigo; sem isso o link caía num domínio que não existe.
  if (override && (local || usable(override) || (key === 'sites' && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(override)))) return override;
  if (local) return `http://127.0.0.1:${LOCAL_PORTS[key]}`;
  if (key === 'helena') return HELENA_DEFAULT;
  if (key === 'sites') return SITES_DEFAULT;
  return `${loc ? loc.origin : 'https://enomera.com.br'}/${PATHS[key]}`;
}

export const PRODUCT_ORIGINS = {
  ambo: productOrigin('ambo'),
  minne: productOrigin('minne'),
  etha: productOrigin('etha'),
  helena: productOrigin('helena'),
  sites: productOrigin('sites'),
};
