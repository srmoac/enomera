// Piloto gratuito (Marcos, 22 nov 2026): para quem entrou por convite do piloto,
// todos os serviços são gratuitos — planos, combos, anual e a implantação Sob medida
// do Site. Nada é cobrado, nenhum cartão é pedido e nenhuma fatura é gerada até o
// lançamento (janeiro de 2027).

export const PILOT_FREE_UNTIL = '2027-01-31T23:59:59.000Z';
export const PILOT_FREE_KINDS = ['tester', 'self_test'];
// Convidados exclusivos (Marcos, 28/11/2026): o feedback de convidado fica com só 2 pessoas,
// cada uma com 1 mês grátis de tudo, contado do cadastro. Quem entrou antes por convite mantém o
// piloto até 31/01/2027; o resto do público segue com as 2 semanas grátis da oferta.
export const EXCLUSIVE_FREE_DAYS = 30;
export const EXCLUSIVE_INVITES = [
  { id: 'inv_exclusivo_1', kind: 'tester', label: 'Convidado exclusivo 1', hash: 'a82782272fab8c95e43eae260c4ba1a0bc24b4eed0a61d39bd2566b1ef9e7f7d' },
  { id: 'inv_exclusivo_2', kind: 'tester', label: 'Convidado exclusivo 2', hash: '4db468c13b3f8d59036b10f2c4fdd79289ff3594dc5e559703d10a871a329ca8' },
];
export const EXCLUSIVE_INVITE_IDS = EXCLUSIVE_INVITES.map((i) => i.id);
const fmtBr = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' });
const ZERO = 'R$ 0,00';

/** Retorna { free, until, kind, exclusive } enquanto o convidado tem o período grátis; senão null. */
export async function getPilotAccess(db, userId) {
  if (!userId) return null;
  const row = await db.get(
    `SELECT kind, invite_id, created_at FROM pilot_participants WHERE user_id = ? AND kind IN (${PILOT_FREE_KINDS.map(() => '?').join(', ')})`,
    userId, ...PILOT_FREE_KINDS
  );
  if (!row) return null;
  const exclusive = EXCLUSIVE_INVITE_IDS.includes(row.invite_id);
  const until = exclusive ? new Date(Date.parse(row.created_at) + EXCLUSIVE_FREE_DAYS * 86_400_000).toISOString() : PILOT_FREE_UNTIL;
  if (Date.now() > Date.parse(until)) return null; // acabou o mês grátis: segue como qualquer conta
  return { free: true, until, kind: row.kind, exclusive };
}
const freeNote = (access) => access?.exclusive ? `Convidado exclusivo: tudo grátis até ${fmtBr(access.until)}.` : 'Piloto: todos os serviços grátis até o lançamento, em janeiro de 2027.';

export function pilotFreeContract(contract, access) {
  if (!contract) return contract;
  return {
    ...contract,
    lines: contract.lines.map((l) => ({ ...l, amountCents: 0, amount: 'Grátis' })),
    discount: null,
    discountHint: null,
    notes: [freeNote(access)],
    setup: contract.setup ? { ...contract.setup, amountCents: 0, amount: 'Grátis', note: 'Incluída no piloto, sem custo.' } : null,
    totalCents: 0,
    totalLabel: 'Total no piloto',
    total: ZERO,
    chargedTodayCents: 0,
    chargedToday: ZERO,
    chargedTodayNote: 'Piloto gratuito · nenhum cartão solicitado',
    pilotFree: true,
    pilotUntil: access?.until || PILOT_FREE_UNTIL,
  };
}

export function pilotFreeQuote(quote, access) {
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
      recurring: access?.exclusive ? `Grátis até ${fmtBr(access.until)}, sem cobrança automática.` : 'Grátis durante o piloto, sem cobrança automática.',
      balanceOnApproval: 'Sem saldo futuro',
      discountWhere: 'Piloto gratuito.',
    },
    pilotFree: true,
    pilotUntil: access?.until || PILOT_FREE_UNTIL,
  };
}
