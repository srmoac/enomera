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
    billing: 'Mensal ou licença permanente',
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
    billing: 'Mensal ou licença permanente',
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
    billing: 'Projeto + hospedagem e painel separados',
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

export function billingFor(ids, mode) {
  return services
    .filter(s => ids.includes(s.id))
    .map(s => ({
      id: s.id,
      text: s.id === 'etha'
        ? 'Criação: pagamento único. Hospedagem e painel: recorrência separada. Identidade visual essencial: adicional.'
        : mode === 'license'
          ? 'Licença: pagamento único, com atualizações futuras incluídas. Hospedagem e suporte separados.'
          : 'Assinatura mensal: hospedagem, atualizações e suporte de uso incluídos.'
    }));
}
