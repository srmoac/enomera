export const CATALOG_VERSION = '2026-11-22-aprovado';

// Preços aprovados por Marcos em 22/11/2026 (19:28). Ambo + Etha e Etha + Minne foram
// definidos pela equipe (decisão reversível). Anual = 10x o mensal. Nenhuma cobrança real.
const MONTHLY_BY_COMBO = {
  ambo: 3900,
  etha: 4900,
  minne: 5900,
  'ambo+etha': 6900,
  'ambo+minne': 7900,
  'etha+minne': 8900,
  'ambo+etha+minne': 9900,
};
export const ANNUAL_MONTHS = 10;

export const COMMERCIAL_CATALOG = {
  version: CATALOG_VERSION,
  isSimulationOnly: true,
  disclaimer: 'Nenhuma cobrança real é feita neste ambiente.',
  currency: 'BRL',
  trialDays: 30,
  pilotWeeks: 4,
  annualMonths: ANNUAL_MONTHS,
  monthlyByCombo: MONTHLY_BY_COMBO,
  products: {
    ambo: {
      id: 'ambo',
      name: 'Ambo',
      role: 'Agendamento e área do paciente',
      monthlyCents: 3900,
      annualCents: 3900 * ANNUAL_MONTHS,
      includes: 'Hospedagem, atualizações e suporte de uso incluídos.',
    },
    minne: {
      id: 'minne',
      name: 'Minne',
      role: 'Gestão clínica, agenda, prontuários e importação',
      monthlyCents: 5900,
      annualCents: 5900 * ANNUAL_MONTHS,
      includes: 'Hospedagem, atualizações e suporte de uso incluídos.',
    },
    etha: {
      id: 'etha',
      name: 'Etha',
      role: 'Site exclusivo, hospedagem e painel',
      monthlyCents: 4900,
      annualCents: 4900 * ANNUAL_MONTHS,
      includes: 'Site exclusivo com briefing guiado, redação para aprovação, publicação, hospedagem e painel de edição.',
    },
  },
  bundle: {
    id: 'combos',
    rule: 'Combos: Ambo + Minne R$ 79, Ambo + Etha R$ 69, Etha + Minne R$ 89 e os três por R$ 99 por mês. Anual = 10 mensalidades.',
  },
  pendingDecisions: [],
};

const ORDERED = ['ambo', 'etha', 'minne'];
export function comboKey(products = []) {
  return ORDERED.filter((p) => products.includes(p)).join('+');
}
/** Mensalidade da combinação (com desconto de combo) e soma avulsa, em centavos. */
export function comboPricing(products = []) {
  const key = comboKey(products);
  const listCents = ORDERED.filter((p) => products.includes(p)).reduce((t, p) => t + COMMERCIAL_CATALOG.products[p].monthlyCents, 0);
  const monthlyCents = MONTHLY_BY_COMBO[key] ?? listCents;
  return { key, listCents, monthlyCents, savingsCents: Math.max(0, listCents - monthlyCents) };
}

export function formatBrl(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);
}

const NAMES = { ambo: 'Ambo', minne: 'Minne', etha: 'Etha' };

/**
 * Cálculo autoritativo no servidor. O cliente manda só os produtos; o servidor calcula tudo.
 * Cobrado hoje é sempre R$ 0 (sem cobrança real).
 */
export function calculateSimulatedQuote({ products = [], ethaFormat = null, mode = 'monthly' }) {
  const unique = new Set(products.filter((p) => ['ambo', 'minne', 'etha'].includes(p)));
  if (unique.size === 0) throw new Error('EMPTY_SELECTION');
  const selected = [...unique];
  const { monthlyCents, listCents, savingsCents } = comboPricing(selected);
  const hasEtha = unique.has('etha');
  const days = COMMERCIAL_CATALOG.trialDays;
  const lines = ORDERED.filter((p) => unique.has(p)).map((p) => ({
    product: p,
    ...(p === 'etha' ? { format: ethaFormat === 'multi_page' ? 'multi_page' : 'one_page' } : {}),
    label: mode === 'trial' ? `${NAMES[p]} · ${days} dias grátis` : `${NAMES[p]} · Assinatura mensal`,
    dueTodayCents: mode === 'trial' ? 0 : COMMERCIAL_CATALOG.products[p].monthlyCents,
    recurringMonthlyCents: COMMERCIAL_CATALOG.products[p].monthlyCents,
    includes: COMMERCIAL_CATALOG.products[p].includes,
  }));
  const comboNote = savingsCents > 0 ? `Combo por ${formatBrl(monthlyCents)}/mês (economia de ${formatBrl(savingsCents)} sobre ${formatBrl(listCents)}).` : '';

  if (mode === 'trial') {
    if (hasEtha) throw new Error('TRIAL_NOT_AVAILABLE_FOR_ETHA');
    return {
      catalogVersion: CATALOG_VERSION,
      mode: 'trial',
      isSimulationOnly: true,
      selectedProducts: selected,
      lines,
      dueTodayCents: 0,
      recurringMonthlyCents: 0,
      postTrialMonthlyCents: monthlyCents,
      balanceOnApprovalCents: 0,
      discountCents: savingsCents,
      discountRule: comboNote || 'Sem desconto de combo com produto isolado.',
      answers: {
        dueToday: `R$ 0,00 (${days} dias grátis, sem cartão)`,
        recurring: `Nenhuma cobrança automática. Depois de ${days} dias, você escolhe contratar ou exportar seus dados.`,
        included: `Acesso completo aos serviços escolhidos durante ${days} dias.`,
        discountWhere: comboNote || 'Desconto só em combos.',
        ifRemoveOne: 'Você pode contratar só um serviço ao final.',
      },
    };
  }

  return {
    catalogVersion: CATALOG_VERSION,
    mode: 'monthly',
    isSimulationOnly: true,
    selectedProducts: selected,
    ethaFormat: hasEtha ? (ethaFormat === 'multi_page' ? 'multi_page' : 'one_page') : null,
    lines,
    referenceDueTodayCents: monthlyCents,
    dueTodayCents: 0,
    chargedTodayCents: 0,
    recurringMonthlyCents: monthlyCents,
    recurringAfterPublishCents: 0,
    balanceOnApprovalCents: 0,
    discountCents: savingsCents,
    nextBillingDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    discountRule: comboNote || 'Sem desconto de combo.',
    answers: {
      dueToday: formatBrl(0),
      recurring: `${formatBrl(monthlyCents)}/mês`,
      balanceOnApproval: 'Sem saldo futuro',
      included: lines.map((l) => `${l.label}: ${l.includes}`).join(' | '),
      discountWhere: comboNote || 'Nenhum desconto (serviço individual).',
      ifRemoveOne: selected.length > 1
        ? 'Ao retirar um serviço, vale o preço da nova combinação. Os dados dos serviços mantidos não se perdem.'
        : 'Cada serviço é independente; cancelar um não afeta os demais.',
    },
  };
}

const CONTRACT_ORDER = ['ambo', 'minne', 'etha'];
const PRODUCT_LABELS = { ambo: 'Ambo', minne: 'Minne', etha: 'Etha' };

/** Normaliza a combinação escolhida (produtos, periodicidade e formato da Etha). */
export function normalizeSelection(input = {}) {
  const raw = Array.isArray(input.products) ? input.products : [];
  const products = CONTRACT_ORDER.filter((p) => raw.includes(p));
  const billing = input.billing === 'permanent' ? 'permanent' : 'monthly';
  const ethaFormat = input.ethaFormat === 'multi_page' ? 'multi_page' : 'one_page';
  return { products, billing, ethaFormat };
}

export function selectionLabel(products = []) {
  const names = CONTRACT_ORDER.filter((p) => products.includes(p)).map((p) => PRODUCT_LABELS[p]);
  if (names.length <= 1) return names[0] || '';
  return names.join(' + ');
}

/**
 * Resumo da contratação na forma aprovada no Figma (22 nov): preço por produto,
 * desconto do combo como linha, periodicidade, total e "cobrado hoje R$ 0,00".
 * Não expõe a versão interna do catálogo.
 */
export function buildContractSummary(input = {}) {
  const sel = normalizeSelection(input);
  if (!sel.products.length) throw new Error('EMPTY_SELECTION');
  const { products, billing, ethaFormat } = sel;
  const annual = billing === 'permanent';
  const mult = annual ? ANNUAL_MONTHS : 1;
  const catalog = COMMERCIAL_CATALOG.products;
  const lines = CONTRACT_ORDER.filter((p) => products.includes(p)).map((p) => {
    const cents = catalog[p].monthlyCents * mult;
    return { product: p, label: PRODUCT_LABELS[p], amountCents: cents, amount: formatBrl(cents) };
  });
  const { monthlyCents, savingsCents } = comboPricing(products);
  const discount = savingsCents > 0
    ? { label: 'Desconto do combo', amountCents: -savingsCents * mult, amount: `−${formatBrl(savingsCents * mult)}` }
    : null;
  let discountHint = null;
  if (products.length < 3) {
    const missing = CONTRACT_ORDER.filter((p) => !products.includes(p));
    const best = missing.map((m) => ({ m, s: comboPricing([...products, m]).savingsCents })).sort((a, b) => b.s - a.s)[0];
    if (best && best.s > 0) discountHint = `Adicione ${PRODUCT_LABELS[best.m]} e pague ${formatBrl(comboPricing([...products, best.m]).monthlyCents)}/mês pelo combo.`;
  }
  const totalCents = monthlyCents * mult;
  const notes = annual ? [`Anual: ${ANNUAL_MONTHS} mensalidades, 2 meses de cortesia.`] : [];
  return {
    products,
    billing,
    ethaFormat: products.includes('etha') ? ethaFormat : null,
    label: selectionLabel(products),
    billingLabel: annual ? 'Anual' : 'Mensal',
    lines,
    discount,
    discountHint,
    notes,
    totalCents,
    totalLabel: annual ? 'Total anual' : 'Total mensal',
    total: `${formatBrl(totalCents)}${annual ? '/ano' : '/mês'}`,
    etha: null,
    trialDays: COMMERCIAL_CATALOG.trialDays,
    chargedTodayCents: 0,
    chargedToday: formatBrl(0),
    chargedTodayNote: `${COMMERCIAL_CATALOG.trialDays} dias grátis · nenhum cartão solicitado`,
  };
}
