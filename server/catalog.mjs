export const CATALOG_VERSION = '2026-11-sim-v2';

export const COMMERCIAL_CATALOG = {
  version: CATALOG_VERSION,
  isSimulationOnly: true,
  disclaimer: 'Preços de simulação provisórios — sem aprovação para cobrança real. Nenhuma cobrança financeira é efetuada neste ambiente.',
  currency: 'BRL',
  trialDays: 7,
  pilotWeeks: 2,
  products: {
    ambo: {
      id: 'ambo',
      name: 'Ambo',
      role: 'Agendamento e área do paciente',
      monthlyCents: 3900,
      includes: 'Hospedagem, atualizações e suporte de uso incluídos na mensalidade.',
      permanentHypothesisCents: 79000,
      permanentStatus: 'hypothesis_pending_definition',
      permanentNote: 'Hipótese R$ 790 (atualizações futuras incluídas; hospedagem gerenciada, suporte e condições separados ainda pendentes de definição).',
    },
    minne: {
      id: 'minne',
      name: 'Minne',
      role: 'Gestão clínica, agenda, prontuários e importação',
      monthlyCents: 6900,
      includes: 'Hospedagem, atualizações e suporte de uso incluídos na mensalidade.',
      permanentHypothesisCents: 139000,
      permanentStatus: 'hypothesis_pending_definition',
      permanentNote: 'Hipótese R$ 1.390 (atualizações futuras incluídas; hospedagem gerenciada, suporte e condições separados ainda pendentes de definição).',
    },
    etha_one_page: {
      id: 'etha_one_page',
      product: 'etha',
      name: 'Etha · Página única',
      productionCents: 119000,
      depositPct: 50,
      depositCents: 59500,
      balanceOnApprovalCents: 59500,
      hostingMonthlyAfterPublishCents: 3900,
      includes: 'Briefing guiado, redação para aprovação, design autoral, 1 rodada consolidada de revisão e publicação. Hospedagem e painel R$ 39/mês somente a partir da publicação.',
    },
    etha_multi_page: {
      id: 'etha_multi_page',
      product: 'etha',
      name: 'Etha · Até quatro páginas',
      productionCents: 219000,
      depositPct: 50,
      depositCents: 109500,
      balanceOnApprovalCents: 109500,
      hostingMonthlyAfterPublishCents: 3900,
      includes: 'Até 4 páginas institucionais, redação, design autoral, 1 rodada consolidada e publicação. Hospedagem e painel R$ 39/mês somente a partir da publicação.',
    },
  },
  bundle: {
    id: 'ambo_minne_monthly',
    products: ['ambo', 'minne'],
    standaloneSumCents: 10800,
    bundleMonthlyCents: 8900,
    savingsCents: 1900,
    rule: 'Combo Ambo + Minne por R$ 89/mês (economia de R$ 19 sobre R$ 108/mês). Não acumula desconto percentual adicional.',
  },
  pendingDecisions: [
    'Aprovação final dos preços comerciais para cobrança real.',
    'Condições definitivas de hospedagem gerenciada e suporte na licença permanente.',
    'Preço e escopo final do adicional de identidade visual essencial na Etha.',
    'Plano anual ou eventual incentivo de meses de hospedagem (não assumidos como aprovados).',
  ],
};

export function formatBrl(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);
}

/**
 * Authoritative server-side commercial quote calculator.
 * Client sends ONLY desired item IDs; server computes every centavo and rule.
 */
export function calculateSimulatedQuote({ products = [], ethaFormat = null, mode = 'monthly' }) {
  const unique = new Set(products.filter((p) => ['ambo', 'minne', 'etha'].includes(p)));
  if (unique.size === 0) {
    throw new Error('EMPTY_SELECTION');
  }

  const lines = [];
  let dueTodayCents = 0;
  let recurringMonthlyCents = 0;
  let recurringAfterPublishCents = 0;
  let balanceOnApprovalCents = 0;
  let discountCents = 0;
  const discountDetails = [];

  const hasAmbo = unique.has('ambo');
  const hasMinne = unique.has('minne');
  const hasEtha = unique.has('etha');

  if (mode === 'trial') {
    if (hasEtha) {
      throw new Error('TRIAL_NOT_AVAILABLE_FOR_ETHA');
    }
    for (const p of ['ambo', 'minne']) {
      if (unique.has(p)) {
        const spec = COMMERCIAL_CATALOG.products[p];
        lines.push({
          product: p,
          label: `${spec.name} · Teste comercial (7 dias, sem cartão)`,
          dueTodayCents: 0,
          recurringMonthlyCents: spec.monthlyCents,
          includes: spec.includes,
        });
      }
    }
    return {
      catalogVersion: CATALOG_VERSION,
      mode: 'trial',
      isSimulationOnly: true,
      selectedProducts: [...unique],
      lines,
      dueTodayCents: 0,
      recurringMonthlyCents: 0,
      postTrialMonthlyCents: hasAmbo && hasMinne ? 8900 : (hasAmbo ? 3900 : 6900),
      balanceOnApprovalCents: 0,
      discountCents: hasAmbo && hasMinne ? 1900 : 0,
      discountRule: hasAmbo && hasMinne ? COMMERCIAL_CATALOG.bundle.rule : 'Sem desconto de pacote com produto isolado.',
      answers: {
        dueToday: 'R$ 0,00 (teste comercial de 7 dias sem cartão)',
        recurring: 'Nenhuma cobrança automática. Após 7 dias, você escolhe contratar ou exportar seus dados.',
        included: 'Acesso funcional completo a Ambo/Minne selecionados durante 7 dias.',
        discountWhere: hasAmbo && hasMinne ? 'Caso contrate ambos após o teste: R$ 89/mês (economia de R$ 19 sobre R$ 108).' : 'Aplicável apenas na contratação combinada Ambo + Minne.',
        ifRemoveOne: 'Pode contratar apenas 1 produto ao final (Ambo R$ 39/mês ou Minne R$ 69/mês).',
      },
    };
  }

  if (hasAmbo && hasMinne) {
    lines.push({
      product: 'ambo',
      label: 'Ambo · Assinatura mensal',
      dueTodayCents: 3900,
      recurringMonthlyCents: 3900,
      includes: COMMERCIAL_CATALOG.products.ambo.includes,
    });
    lines.push({
      product: 'minne',
      label: 'Minne · Assinatura mensal',
      dueTodayCents: 6900,
      recurringMonthlyCents: 6900,
      includes: COMMERCIAL_CATALOG.products.minne.includes,
    });
    discountCents += 1900;
    dueTodayCents += 8900;
    recurringMonthlyCents += 8900;
    discountDetails.push('Economia de R$ 19,00/mês no combo Ambo + Minne (de R$ 108,00 por R$ 89,00/mês).');
  } else {
    if (hasAmbo) {
      lines.push({
        product: 'ambo',
        label: 'Ambo · Assinatura mensal',
        dueTodayCents: 3900,
        recurringMonthlyCents: 3900,
        includes: COMMERCIAL_CATALOG.products.ambo.includes,
      });
      dueTodayCents += 3900;
      recurringMonthlyCents += 3900;
    }
    if (hasMinne) {
      lines.push({
        product: 'minne',
        label: 'Minne · Assinatura mensal',
        dueTodayCents: 6900,
        recurringMonthlyCents: 6900,
        includes: COMMERCIAL_CATALOG.products.minne.includes,
      });
      dueTodayCents += 6900;
      recurringMonthlyCents += 6900;
    }
  }

  if (hasEtha) {
    const fmt = ethaFormat === 'multi_page' ? 'etha_multi_page' : 'etha_one_page';
    const spec = COMMERCIAL_CATALOG.products[fmt];
    lines.push({
      product: 'etha',
      format: fmt === 'etha_multi_page' ? 'multi_page' : 'one_page',
      label: `${spec.name} · Entrada 50% hoje + saldo 50% na aprovação`,
      dueTodayCents: spec.depositCents,
      balanceOnApprovalCents: spec.balanceOnApprovalCents,
      recurringAfterPublishCents: spec.hostingMonthlyAfterPublishCents,
      includes: spec.includes,
    });
    dueTodayCents += spec.depositCents;
    balanceOnApprovalCents += spec.balanceOnApprovalCents;
    recurringAfterPublishCents += spec.hostingMonthlyAfterPublishCents;
  }

  const nextBillingDate = new Date(Date.now() + 30 * 86_400_000).toISOString();

  return {
    catalogVersion: CATALOG_VERSION,
    mode: 'monthly',
    isSimulationOnly: true,
    selectedProducts: [...unique],
    ethaFormat: hasEtha ? (ethaFormat === 'multi_page' ? 'multi_page' : 'one_page') : null,
    lines,
    dueTodayCents,
    recurringMonthlyCents,
    recurringAfterPublishCents,
    balanceOnApprovalCents,
    discountCents,
    nextBillingDate,
    discountRule: discountDetails.join(' ') || 'Sem desconto combinado aplicado.',
    answers: {
      dueToday: formatBrl(dueTodayCents),
      recurring: [
        recurringMonthlyCents > 0 ? `${formatBrl(recurringMonthlyCents)}/mês (SaaS ativo)` : null,
        recurringAfterPublishCents > 0 ? `+ ${formatBrl(recurringAfterPublishCents)}/mês de hospedagem/painel Etha somente após publicação` : null,
      ].filter(Boolean).join(' ') || 'Sem recorrência imediata',
      balanceOnApproval: balanceOnApprovalCents > 0 ? `${formatBrl(balanceOnApprovalCents)} na aprovação final da versão da Etha` : 'Sem saldo futuro de produção',
      included: lines.map((l) => `${l.label}: ${l.includes}`).join(' | '),
      discountWhere: discountDetails.join(' ') || 'Nenhum desconto aplicado (produto individual).',
      ifRemoveOne: hasAmbo && hasMinne
        ? 'Ao retirar Ambo ou Minne, encerra-se o combo de R$ 89/mês: somente Ambo = R$ 39/mês; somente Minne = R$ 69/mês. Os dados do serviço mantido não são perdidos.'
        : 'Cada serviço é independente; cancelar um produto não afeta nem apaga os demais.',
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
  const hasAmbo = products.includes('ambo');
  const hasMinne = products.includes('minne');
  const hasEtha = products.includes('etha');
  const catalog = COMMERCIAL_CATALOG.products;
  const lines = [];
  let subtotalCents = 0;
  let discount = null;
  let discountHint = null;
  const notes = [];

  for (const p of ['ambo', 'minne']) {
    if (!products.includes(p)) continue;
    const cents = billing === 'permanent' ? catalog[p].permanentHypothesisCents : catalog[p].monthlyCents;
    lines.push({ product: p, label: PRODUCT_LABELS[p], amountCents: cents, amount: formatBrl(cents) });
    subtotalCents += cents;
  }

  if (billing === 'monthly') {
    if (hasAmbo && hasMinne) {
      discount = { label: 'Desconto do combo', amountCents: -COMMERCIAL_CATALOG.bundle.savingsCents, amount: `−${formatBrl(COMMERCIAL_CATALOG.bundle.savingsCents)}` };
    } else if (hasAmbo || hasMinne) {
      discountHint = `Adicione ${hasAmbo ? 'Minne' : 'Ambo'} e economize ${formatBrl(COMMERCIAL_CATALOG.bundle.savingsCents)}/mês.`;
    }
  } else if (hasAmbo || hasMinne) {
    notes.push('Hospedagem e suporte da licença: cobrados à parte, valor em definição.');
    if (hasAmbo && hasMinne) notes.push('Desconto do combo na licença: em definição.');
  }

  const totalCents = subtotalCents + (discount ? discount.amountCents : 0);
  let etha = null;
  if (hasEtha) {
    const spec = catalog[ethaFormat === 'multi_page' ? 'etha_multi_page' : 'etha_one_page'];
    etha = {
      format: ethaFormat,
      label: ethaFormat === 'multi_page' ? 'Etha · até quatro páginas' : 'Etha · página única',
      projectCents: spec.productionCents,
      project: formatBrl(spec.productionCents),
      split: `${formatBrl(spec.depositCents)} + ${formatBrl(spec.balanceOnApprovalCents)} (50% + 50%)`,
      hostingAfterPublish: `${formatBrl(spec.hostingMonthlyAfterPublishCents)}/mês após publicar`,
    };
  }

  const hasSaas = hasAmbo || hasMinne;
  return {
    products,
    billing,
    ethaFormat: hasEtha ? ethaFormat : null,
    label: selectionLabel(products),
    billingLabel: billing === 'permanent' ? 'Licença permanente' : 'Mensal',
    lines,
    discount,
    discountHint,
    notes,
    totalCents: hasSaas ? totalCents : (etha ? etha.projectCents : 0),
    totalLabel: hasSaas ? (billing === 'permanent' ? 'Total da licença' : 'Total mensal') : 'Projeto Etha',
    total: hasSaas ? `${formatBrl(totalCents)}${billing === 'monthly' ? '/mês' : ''}` : (etha ? etha.project : formatBrl(0)),
    etha,
    chargedTodayCents: 0,
    chargedToday: formatBrl(0),
    chargedTodayNote: 'nenhum cartão solicitado',
  };
}
