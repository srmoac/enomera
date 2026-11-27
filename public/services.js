// Destinos do ecossistema: sempre no mesmo domínio, por caminho (ver eno-origins.js).
import { PRODUCT_ORIGINS } from './eno-origins.js';
const withSlash = url => (url.endsWith('/') ? url : `${url}/`);
const injected = typeof window === 'undefined' ? {} : window;
const helenaBase = withSlash(PRODUCT_ORIGINS.helena);
const enomeraBase = typeof location === 'undefined' ? 'https://enomera.vercel.app/' : `${location.origin}/`;

export const ecosystem = {
  enomera: enomeraBase,
  portal: `${enomeraBase}portal`,
  etha: withSlash(PRODUCT_ORIGINS.etha),
  // O site integrado atende vários profissionais; o exemplo abre o da Helena.
  helena: injected.__ENOMERA_HELENA_URL ? `${helenaBase}?site=helena-duarte` : helenaBase,
  minne: withSlash(PRODUCT_ORIGINS.minne),
  ambo: withSlash(PRODUCT_ORIGINS.ambo)
};

export const services = [
  {
    id: 'ambo',
    name: 'Agendamento',
    description: 'Agendamento e área do paciente',
    billing: 'Mensal ou anual',
    section: '#ambo',
    destination: ecosystem.ambo || '#ambo',
    externalDestination: ecosystem.ambo,
    externalLabel: 'Abrir o Agendamento ↗',
    availability: ecosystem.ambo ? 'published-product' : 'embedded-demo',
    embeddedDemo: true
  },
  {
    id: 'minne',
    name: 'Consultório',
    description: 'Gestão clínica e continuidade',
    billing: 'Mensal ou anual',
    section: '#minne',
    destination: ecosystem.minne,
    externalDestination: ecosystem.minne,
    externalLabel: 'Abrir o Consultório ↗',
    availability: 'published-product',
    embeddedDemo: true
  },
  {
    id: 'etha',
    name: 'Site',
    description: 'Site exclusivo para o profissional',
    billing: 'Mensal ou anual · site e hospedagem',
    section: '#etha',
    destination: ecosystem.etha,
    externalDestination: ecosystem.etha,
    externalLabel: 'Conhecer o Enomera Site ↗',
    exampleDestination: ecosystem.helena,
    exampleLabel: 'Explorar o site da Helena ↗',
    availability: 'published-product',
    embeddedDemo: false
  }
];

export function serviceById(id) {
  return services.find(s => s.id === id);
}

// Preços aprovados em 22/11/2026. Anual = 10 mensalidades. A fonte é server/catalog.mjs;
// tests/auditoria-2611.test.mjs falha se estes números divergirem do catálogo.
export const MONTHLY = { ambo: 39, etha: 49, minne: 59 };
export const COMBO = { 'ambo+minne': 79, 'ambo+etha': 69, 'etha+minne': 89, 'ambo+etha+minne': 99 };
const brl = n => `R$ ${n.toLocaleString('pt-BR')}`;

// Convidado do piloto (marcado pelo convite ou pelo portal): tudo grátis, sem preço a pagar.
export function pilotFree() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('eno_piloto_gratis') === '1'; } catch { return false; }
}

export function comboPrice(ids, mode) {
  if (pilotFree()) return { total: 'Grátis no piloto', savings: '' };
  const key = ['ambo', 'etha', 'minne'].filter(p => ids.includes(p)).join('+');
  const list = ids.reduce((t, id) => t + (MONTHLY[id] || 0), 0);
  const monthly = COMBO[key] ?? list;
  const mult = mode === 'license' ? 10 : 1;
  return { total: brl(monthly * mult) + (mult === 10 ? '/ano' : '/mês'), savings: list > monthly ? brl((list - monthly) * mult) : '' };
}

// O Sob medida é opcional: o link leva à explicação dos dois formatos na página do Enomera Site.
const SOB_MEDIDA_LINK = '<a class="text-link billing-link" href="/site/#formatos">Sob medida</a>';

export function billingFor(ids, mode) {
  const annual = mode === 'license';
  return services
    .filter(s => ids.includes(s.id))
    .map(s => ({
      id: s.id,
      text: pilotFree() ? `Grátis no piloto · ${s.id === 'etha' ? `site e hospedagem, inclusive o ${SOB_MEDIDA_LINK}` : 'hospedagem, atualizações e suporte incluídos'}` : `${brl(MONTHLY[s.id] * (annual ? 10 : 1))}${annual ? '/ano' : '/mês'} · ${s.id === 'etha' ? `site e hospedagem, sem taxa de implantação. Opcional: ${SOB_MEDIDA_LINK}, em que a equipe faz o site por você (R$ 790 de implantação, até 3x)` : 'hospedagem, atualizações e suporte incluídos'}`
    }));
}
