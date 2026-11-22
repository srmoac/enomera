// Destinos do ecossistema. O build injeta os endereços do conjunto de previews
// (window.__ENOMERA_*_URL); sem injeção, valem os endereços públicos.
const injected = typeof window === 'undefined' ? {} : window;
const withSlash = url => (url.endsWith('/') ? url : `${url}/`);
const pick = (key, fallback) => withSlash(String(injected[key] || fallback).trim());
const helenaBase = pick('__ENOMERA_HELENA_URL', 'https://helenaduartepsi.vercel.app/');
const enomeraBase = typeof location === 'undefined' ? 'https://enomera.vercel.app/' : `${location.origin}/`;

export const ecosystem = {
  enomera: enomeraBase,
  portal: `${enomeraBase}portal`,
  etha: pick('__ENOMERA_ETHA_URL', 'https://etha-enomera.vercel.app/'),
  // O site integrado atende vários profissionais; o exemplo abre o da Helena.
  helena: injected.__ENOMERA_HELENA_URL ? `${helenaBase}?site=helena-duarte` : helenaBase,
  minne: pick('__ENOMERA_MINNE_URL', 'https://minne-enomera.vercel.app/'),
  ambo: pick('__ENOMERA_AMBO_URL', 'https://ambo-enomera.vercel.app/')
};

export const services = [
  {
    id: 'ambo',
    name: 'ambo',
    description: 'Agendamento e área do paciente',
    billing: 'Mensal ou anual',
    section: '#ambo',
    destination: ecosystem.ambo || '#ambo',
    externalDestination: ecosystem.ambo,
    externalLabel: 'Abrir o Ambo ↗',
    availability: ecosystem.ambo ? 'published-product' : 'embedded-demo',
    embeddedDemo: true,
    legacy: 'https://lotus-app-phi.vercel.app/'
  },
  {
    id: 'minne',
    name: 'minne',
    description: 'Gestão clínica e continuidade',
    billing: 'Mensal ou anual',
    section: '#minne',
    destination: ecosystem.minne,
    externalDestination: ecosystem.minne,
    externalLabel: 'Abrir o Minne ↗',
    availability: 'published-product',
    embeddedDemo: true
  },
  {
    id: 'etha',
    name: 'etha',
    description: 'Site exclusivo para o profissional',
    billing: 'Mensal ou anual · site, hospedagem e painel',
    section: '#etha',
    destination: ecosystem.etha,
    externalDestination: ecosystem.etha,
    externalLabel: 'Conhecer o site da Etha ↗',
    exampleDestination: ecosystem.helena,
    exampleLabel: 'Explorar o site da Helena ↗',
    availability: 'published-product',
    embeddedDemo: false
  }
];

export function serviceById(id) {
  return services.find(s => s.id === id);
}

// Preços aprovados em 22/11/2026. Anual = 10 mensalidades. Espelha server/catalog.mjs.
export const MONTHLY = { ambo: 39, etha: 49, minne: 59 };
const COMBO = { 'ambo+minne': 79, 'ambo+etha': 69, 'etha+minne': 89, 'ambo+etha+minne': 99 };
const brl = n => `R$ ${n.toLocaleString('pt-BR')}`;

export function comboPrice(ids, mode) {
  const key = ['ambo', 'etha', 'minne'].filter(p => ids.includes(p)).join('+');
  const list = ids.reduce((t, id) => t + (MONTHLY[id] || 0), 0);
  const monthly = COMBO[key] ?? list;
  const mult = mode === 'license' ? 10 : 1;
  return { total: brl(monthly * mult) + (mult === 10 ? '/ano' : '/mês'), savings: list > monthly ? brl((list - monthly) * mult) : '' };
}

export function billingFor(ids, mode) {
  const annual = mode === 'license';
  return services
    .filter(s => ids.includes(s.id))
    .map(s => ({
      id: s.id,
      text: `${brl(MONTHLY[s.id] * (annual ? 10 : 1))}${annual ? '/ano' : '/mês'} · ${s.id === 'etha' ? 'site, hospedagem e painel (Sob medida: + R$ 790 de implantação, até 3x)' : 'hospedagem, atualizações e suporte incluídos'}`
    }));
}
