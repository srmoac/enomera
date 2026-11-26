// Piloto gratuito (Marcos, 22 nov 2026): para quem entrou por convite do piloto,
// todos os serviços são gratuitos — planos, combos, anual e a implantação Sob medida
// do Site. Nada é cobrado, nenhum cartão é pedido e nenhuma fatura é gerada até o
// lançamento (janeiro de 2027).

export const PILOT_FREE_UNTIL = '2027-01-31T23:59:59.000Z';
export const PILOT_FREE_KINDS = ['tester', 'self_test'];
const ZERO = 'R$ 0,00';

/** Retorna { free, until, kind } quando o usuário é convidado do piloto; senão null. */
export async function getPilotAccess(db, userId) {
  if (!userId) return null;
  const row = await db.get(
    `SELECT kind FROM pilot_participants WHERE user_id = ? AND kind IN (${PILOT_FREE_KINDS.map(() => '?').join(', ')})`,
    userId, ...PILOT_FREE_KINDS
  );
  return row ? { free: true, until: PILOT_FREE_UNTIL, kind: row.kind } : null;
}

export function pilotFreeContract(contract) {
  if (!contract) return contract;
  return {
    ...contract,
    lines: contract.lines.map((l) => ({ ...l, amountCents: 0, amount: 'Grátis' })),
    discount: null,
    discountHint: null,
    notes: ['Piloto: todos os serviços grátis até o lançamento, em janeiro de 2027.'],
    setup: contract.setup ? { ...contract.setup, amountCents: 0, amount: 'Grátis', note: 'Incluída no piloto, sem custo.' } : null,
    totalCents: 0,
    totalLabel: 'Total no piloto',
    total: ZERO,
    chargedTodayCents: 0,
    chargedToday: ZERO,
    chargedTodayNote: 'Piloto gratuito · nenhum cartão solicitado',
    pilotFree: true,
    pilotUntil: PILOT_FREE_UNTIL,
  };
}

export function pilotFreeQuote(quote) {
  if (!quote) return quote;
  return {
    ...quote,
    lines: (quote.lines || []).map((l) => ({ ...l, dueTodayCents: 0, recurringMonthlyCents: 0 })),
    setup: quote.setup ? { ...quote.setup, amountCents: 0, amount: 'Grátis', note: 'Incluída no piloto, sem custo.' } : quote.setup,
    referenceDueTodayCents: 0,
    dueTodayCents: 0,
    chargedTodayCents: 0,
    recurringMonthlyCents: 0,
    postTrialMonthlyCents: 0,
    recurringAfterPublishCents: 0,
    balanceOnApprovalCents: 0,
    discountCents: 0,
    nextBillingDate: null,
    discountRule: 'Piloto gratuito.',
    answers: {
      ...(quote.answers || {}),
      dueToday: ZERO,
      recurring: 'Grátis durante o piloto, sem cobrança automática.',
      balanceOnApproval: 'Sem saldo futuro',
      discountWhere: 'Piloto gratuito.',
    },
    pilotFree: true,
    pilotUntil: PILOT_FREE_UNTIL,
  };
}
