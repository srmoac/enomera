import { nowIso, randomId } from './crypto.mjs';
import { runTransaction, writeAudit } from './db.mjs';

const SAO_PAULO_OFFSET = '-03:00';

/**
 * Generates dynamic availability slots for the next `daysAhead` days
 * in explicit America/Sao_Paulo (-03:00) timezone semantics.
 * Never hardcodes November 2026 dates!
 */
export function generateAvailableSlots(db, accountId, { daysAhead = 14, modality = null } = {}) {
  const account = db.prepare('SELECT id, session_duration_min, timezone FROM professional_accounts WHERE id = ?').get(accountId);
  if (!account) return [];
  const durationMin = account.session_duration_min || 50;

  const rules = db.prepare('SELECT * FROM availability_rules WHERE account_id = ? AND active = 1').all(accountId);
  const blocks = db.prepare('SELECT * FROM availability_blocks WHERE account_id = ?').all(accountId);
  const booked = db.prepare(`
    SELECT start_at, end_at FROM appointments
    WHERE account_id = ? AND status IN ('confirmed', 'reschedule_requested')
  `).all(accountId);

  const bookedMs = booked.map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }));
  const blockMs = blocks.map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }));

  const now = new Date();
  const minLeadMs = now.getTime() + 60 * 60_000; // at least 1h ahead
  const slots = [];

  for (let d = 0; d <= daysAhead; d++) {
    const dt = new Date(now.getTime() + d * 86_400_000);
    // Compute YYYY-MM-DD in America/Sao_Paulo (-03:00)
    const sp = new Date(dt.getTime() - 3 * 3600_000);
    const yyyy = sp.getUTCFullYear();
    const mm = String(sp.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(sp.getUTCDate()).padStart(2, '0');
    const weekday = sp.getUTCDay(); // 0=Sun..6=Sat
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const dayRules = rules.filter((r) => r.weekday === weekday && (!modality || r.modality === 'both' || r.modality === modality));
    for (const rule of dayRules) {
      const [sh, sm] = rule.start_time.split(':').map(Number);
      const [eh, em] = rule.end_time.split(':').map(Number);
      let cursorMin = sh * 60 + sm;
      const endLimitMin = eh * 60 + em;
      while (cursorMin + durationMin <= endLimitMin) {
        const hh1 = String(Math.floor(cursorMin / 60)).padStart(2, '0');
        const mm1 = String(cursorMin % 60).padStart(2, '0');
        const endCursor = cursorMin + durationMin;
        const hh2 = String(Math.floor(endCursor / 60)).padStart(2, '0');
        const mm2 = String(endCursor % 60).padStart(2, '0');

        const startAt = `${dateStr}T${hh1}:${mm1}:00${SAO_PAULO_OFFSET}`;
        const endAt = `${dateStr}T${hh2}:${mm2}:00${SAO_PAULO_OFFSET}`;
        const sMs = Date.parse(startAt);
        const eMs = Date.parse(endAt);

        const overlapsBlock = blockMs.some((b) => sMs < b.end && eMs > b.start);
        const overlapsBooked = bookedMs.some((b) => sMs < b.end && eMs > b.start);

        if (sMs >= minLeadMs && !overlapsBlock && !overlapsBooked) {
          slots.push({
            id: `slot_${dateStr}_${hh1}${mm1}`,
            date: dateStr,
            startTime: `${hh1}:${mm1}`,
            endTime: `${hh2}:${mm2}`,
            startAt,
            endAt,
            timezone: account.timezone || 'America/Sao_Paulo',
            modality: rule.modality,
          });
        }
        cursorMin += 60; // hourly cadence
      }
    }
  }
  return slots;
}

export function findDuplicatePatientCandidate(db, accountId, { email = '', phone = '', fullName = '' }) {
  const normEmail = email.trim().toLowerCase();
  const normPhone = phone.replace(/\D/g, '');
  const normName = fullName.trim().toLowerCase();
  const patients = db.prepare('SELECT id, full_name, email, phone, status FROM operational_patients WHERE account_id = ?').all(accountId);
  for (const p of patients) {
    if (normEmail && p.email && p.email.trim().toLowerCase() === normEmail) return p;
    if (normPhone.length >= 8 && p.phone && p.phone.replace(/\D/g, '').endsWith(normPhone.slice(-8))) return p;
    if (normName && p.full_name.trim().toLowerCase() === normName) return p;
  }
  return null;
}

function recordSyncEvent(db, { accountId, eventType, sourceProduct, targetProduct, entityType, entityId, payload, simulateDelayedSync = false }) {
  const id = randomId('sync');
  const now = nowIso();
  const status = simulateDelayedSync ? 'pending_retry' : 'synced';
  const lastError = simulateDelayedSync ? 'Propagação em andamento — registro principal já gravado; tente sincronizar novamente se necessário.' : null;
  db.prepare(`
    INSERT INTO sync_events (id, account_id, event_type, source_product, target_product, entity_type, entity_id, payload_json, status, attempts, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(id, accountId, eventType, sourceProduct, targetProduct, entityType, entityId, JSON.stringify(payload), status, lastError, now, now);
  return { id, status, lastError };
}

function assertSlotAvailableTx(db, accountId, startAt, endAt, excludeAppointmentId = null) {
  const sMs = Date.parse(startAt);
  const eMs = Date.parse(endAt);
  if (Number.isNaN(sMs) || Number.isNaN(eMs) || eMs <= sMs) {
    throw Object.assign(new Error('Intervalo de horário inválido.'), { status: 400, code: 'INVALID_SLOT' });
  }
  const blocks = db.prepare('SELECT start_at, end_at, reason FROM availability_blocks WHERE account_id = ?').all(accountId);
  for (const b of blocks) {
    if (sMs < Date.parse(b.end_at) && eMs > Date.parse(b.start_at)) {
      const suggestions = generateAvailableSlots(db, accountId, { daysAhead: 10 }).slice(0, 4);
      throw Object.assign(new Error(`Horário bloqueado (${b.reason}). Escolha outro horário disponível.`), {
        status: 409,
        code: 'SLOT_BLOCKED',
        suggestions,
      });
    }
  }
  const active = db.prepare(`
    SELECT id, start_at, end_at FROM appointments
    WHERE account_id = ? AND status IN ('confirmed', 'reschedule_requested')
  `).all(accountId);
  for (const a of active) {
    if (excludeAppointmentId && a.id === excludeAppointmentId) continue;
    if (sMs < Date.parse(a.end_at) && eMs > Date.parse(a.start_at)) {
      const suggestions = generateAvailableSlots(db, accountId, { daysAhead: 10 }).slice(0, 4);
      throw Object.assign(new Error('Esse horário acabou de ser ocupado. Escolha outro horário disponível.'), {
        status: 409,
        code: 'SLOT_CONFLICT',
        suggestions,
      });
    }
  }
}

export function confirmConsultationRequest(db, {
  accountId,
  actorUserId,
  requestId,
  startAt,
  endAt,
  modality,
  patientResolution = 'create_new', // create_new | link_existing
  linkPatientId = null,
  idempotencyKey = null,
  sourceProduct = 'minne',
  simulateDelayedSync = false,
}) {
  return runTransaction(db, () => {
    const req = db.prepare('SELECT * FROM consultation_requests WHERE id = ? AND account_id = ?').get(requestId, accountId);
    if (!req) throw Object.assign(new Error('Solicitação não encontrada.'), { status: 404, code: 'REQUEST_NOT_FOUND' });

    // Idempotent return if already confirmed with same idempotencyKey or already confirmed
    if (idempotencyKey) {
      const existingAppt = db.prepare('SELECT * FROM appointments WHERE account_id = ? AND idempotency_key = ?').get(accountId, idempotencyKey);
      if (existingAppt) {
        return { appointment: existingAppt, request: req, idempotentReplay: true, syncEvent: null };
      }
    }
    if (req.status === 'confirmed' && req.appointment_id) {
      const existingAppt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.appointment_id);
      return { appointment: existingAppt, request: req, idempotentReplay: true, syncEvent: null };
    }
    if (req.status !== 'preference_sent') {
      throw Object.assign(new Error('Esta solicitação não está mais pendente.'), { status: 409, code: 'REQUEST_NOT_PENDING' });
    }

    assertSlotAvailableTx(db, accountId, startAt, endAt);

    const account = db.prepare('SELECT session_price_cents, timezone FROM professional_accounts WHERE id = ?').get(accountId);
    const now = nowIso();
    let patientId = req.patient_id;

    if (patientResolution === 'link_existing' && linkPatientId) {
      const target = db.prepare('SELECT id FROM operational_patients WHERE id = ? AND account_id = ?').get(linkPatientId, accountId);
      if (!target) throw Object.assign(new Error('Cadastro de paciente para vínculo não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
      patientId = target.id;
    } else if (!patientId) {
      patientId = randomId('pat');
      db.prepare(`
        INSERT INTO operational_patients (id, account_id, full_name, email, phone, birth_date, preferred_contact, status, origin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'email', 'active', 'ambo_first_request', ?, ?)
      `).run(patientId, accountId, req.patient_name, req.patient_email, req.patient_phone, req.patient_birth || '', now, now);

      if (req.guardian_json) {
        try {
          const g = JSON.parse(req.guardian_json);
          if (g && g.name) {
            db.prepare(`
              INSERT INTO patient_guardians (id, account_id, patient_id, guardian_name, relation, contact, verified_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
            `).run(randomId('grd'), accountId, patientId, g.name, g.relation || 'Responsável', g.contact || '', now);
          }
        } catch {}
      }
    }

    const appointmentId = randomId('apt');
    db.prepare(`
      INSERT INTO appointments (id, account_id, patient_id, request_id, idempotency_key, origin, modality, start_at, end_at, timezone, status, price_cents, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ambo_request', ?, ?, ?, ?, 'confirmed', ?, 1, ?, ?)
    `).run(appointmentId, accountId, patientId, req.id, idempotencyKey || `confirm_${req.id}`, modality || req.modality, startAt, endAt, account.timezone || 'America/Sao_Paulo', account.session_price_cents || 22000, now, now);

    db.prepare(`
      UPDATE consultation_requests SET status = 'confirmed', patient_id = ?, appointment_id = ?, updated_at = ?
      WHERE id = ?
    `).run(patientId, appointmentId, now, req.id);

    const syncEvent = recordSyncEvent(db, {
      accountId,
      eventType: 'appointment.confirmed',
      sourceProduct,
      targetProduct: sourceProduct === 'minne' ? 'ambo' : 'minne',
      entityType: 'appointment',
      entityId: appointmentId,
      payload: { appointmentId, requestId: req.id, protocolCode: req.protocol_code, startAt, endAt, modality: modality || req.modality, status: 'confirmed' },
      simulateDelayedSync,
    });

    writeAudit(db, {
      actorUserId,
      actorType: 'professional',
      accountId,
      action: 'appointment.confirm_request',
      resourceType: 'appointment',
      resourceId: appointmentId,
      meta: { requestId: req.id, patientResolution, syncStatus: syncEvent.status },
    });

    const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
    const updatedReq = db.prepare('SELECT * FROM consultation_requests WHERE id = ?').get(req.id);
    return { appointment, request: updatedReq, idempotentReplay: false, syncEvent };
  });
}

export function createManualAppointment(db, { accountId, actorUserId, patientId, startAt, endAt, modality, idempotencyKey = null }) {
  return runTransaction(db, () => {
    if (idempotencyKey) {
      const existing = db.prepare('SELECT * FROM appointments WHERE account_id = ? AND idempotency_key = ?').get(accountId, idempotencyKey);
      if (existing) return { appointment: existing, idempotentReplay: true };
    }
    const patient = db.prepare('SELECT id FROM operational_patients WHERE id = ? AND account_id = ?').get(patientId, accountId);
    if (!patient) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });

    assertSlotAvailableTx(db, accountId, startAt, endAt);

    const account = db.prepare('SELECT session_price_cents, timezone FROM professional_accounts WHERE id = ?').get(accountId);
    const now = nowIso();
    const id = randomId('apt');
    db.prepare(`
      INSERT INTO appointments (id, account_id, patient_id, idempotency_key, origin, modality, start_at, end_at, timezone, status, price_cents, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'minne_manual', ?, ?, ?, ?, 'confirmed', ?, 1, ?, ?)
    `).run(id, accountId, patientId, idempotencyKey, modality || 'online', startAt, endAt, account.timezone || 'America/Sao_Paulo', account.session_price_cents || 22000, now, now);

    writeAudit(db, { actorUserId, actorType: 'professional', accountId, action: 'appointment.create_manual', resourceType: 'appointment', resourceId: id });
    return { appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(id), idempotentReplay: false };
  });
}

export function reserveSlotByInvitation(db, { accountId, patientId, invitationId, startAt, endAt, modality, idempotencyKey = null }) {
  return runTransaction(db, () => {
    if (idempotencyKey) {
      const existing = db.prepare('SELECT * FROM appointments WHERE account_id = ? AND idempotency_key = ?').get(accountId, idempotencyKey);
      if (existing) return { appointment: existing, idempotentReplay: true };
    }
    const inv = db.prepare('SELECT * FROM patient_invitations WHERE id = ? AND account_id = ? AND patient_id = ?').get(invitationId, accountId, patientId);
    if (!inv) throw Object.assign(new Error('Convite não encontrado.'), { status: 404, code: 'INVITE_NOT_FOUND' });
    if (inv.status === 'used') throw Object.assign(new Error('Este convite já foi utilizado. Entre na sua área do paciente para consultar ou remarcar.'), { status: 409, code: 'INVITE_ALREADY_USED' });
    if (inv.status !== 'active' || Date.parse(inv.expires_at) < Date.now()) {
      throw Object.assign(new Error('Este convite expirou. Solicite um reenvio à profissional.'), { status: 410, code: 'INVITE_EXPIRED' });
    }

    assertSlotAvailableTx(db, accountId, startAt, endAt);

    const account = db.prepare('SELECT session_price_cents, timezone FROM professional_accounts WHERE id = ?').get(accountId);
    const now = nowIso();
    const id = randomId('apt');
    db.prepare(`
      INSERT INTO appointments (id, account_id, patient_id, idempotency_key, origin, modality, start_at, end_at, timezone, status, price_cents, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ambo_invite', ?, ?, ?, ?, 'confirmed', ?, 1, ?, ?)
    `).run(id, accountId, patientId, idempotencyKey || `inv_${inv.id}`, modality || 'online', startAt, endAt, account.timezone || 'America/Sao_Paulo', account.session_price_cents || 22000, now, now);

    db.prepare("UPDATE patient_invitations SET status = 'used', used_at = ? WHERE id = ?").run(now, inv.id);

    recordSyncEvent(db, {
      accountId,
      eventType: 'appointment.reserved_by_invite',
      sourceProduct: 'ambo',
      targetProduct: 'minne',
      entityType: 'appointment',
      entityId: id,
      payload: { appointmentId: id, startAt, endAt, modality: modality || 'online', status: 'confirmed' },
    });

    writeAudit(db, { actorType: 'patient', accountId, action: 'appointment.reserve_invite', resourceType: 'appointment', resourceId: id, meta: { invitationId: inv.id } });
    return { appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(id), idempotentReplay: false };
  });
}

export function requestAppointmentReschedule(db, { accountId, appointmentId, patientId, requestedStartAt = null, requestedEndAt = null, preferences = {}, reason = '', idempotencyKey }) {
  return runTransaction(db, () => {
    const existing = db.prepare('SELECT * FROM reschedule_requests WHERE appointment_id = ? AND idempotency_key = ?').get(appointmentId, idempotencyKey);
    if (existing) {
      const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
      return { reschedule: existing, appointment: appt, idempotentReplay: true };
    }
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ? AND account_id = ? AND patient_id = ?').get(appointmentId, accountId, patientId);
    if (!appt) throw Object.assign(new Error('Consulta não encontrada.'), { status: 404, code: 'APPOINTMENT_NOT_FOUND' });
    if (!['confirmed', 'reschedule_requested'].includes(appt.status)) {
      throw Object.assign(new Error('Apenas consultas confirmadas podem solicitar alteração.'), { status: 409, code: 'INVALID_STATUS' });
    }

    const now = nowIso();
    const id = randomId('rsc');
    db.prepare(`
      INSERT INTO reschedule_requests (id, account_id, appointment_id, patient_id, idempotency_key, original_start_at, original_end_at, requested_start_at, requested_end_at, preferences_json, reason, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, accountId, appointmentId, patientId, idempotencyKey, appt.start_at, appt.end_at, requestedStartAt, requestedEndAt, JSON.stringify(preferences || {}), reason || '', now, now);

    // IMPORTANT: original start_at/end_at remain UNCHANGED and slot remains locked until professional approves!
    db.prepare("UPDATE appointments SET status = 'reschedule_requested', version = version + 1, updated_at = ? WHERE id = ?").run(now, appointmentId);

    const syncEvent = recordSyncEvent(db, {
      accountId,
      eventType: 'appointment.reschedule_requested',
      sourceProduct: 'ambo',
      targetProduct: 'minne',
      entityType: 'reschedule_request',
      entityId: id,
      payload: { rescheduleId: id, appointmentId, originalStartAt: appt.start_at, requestedStartAt },
    });

    writeAudit(db, { actorType: 'patient', accountId, action: 'appointment.reschedule_request', resourceType: 'reschedule_request', resourceId: id });
    return {
      reschedule: db.prepare('SELECT * FROM reschedule_requests WHERE id = ?').get(id),
      appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId),
      syncEvent,
      idempotentReplay: false,
    };
  });
}

export function decideRescheduleRequest(db, { accountId, actorUserId, rescheduleId, decision, newStartAt = null, newEndAt = null }) {
  return runTransaction(db, () => {
    const rsc = db.prepare('SELECT * FROM reschedule_requests WHERE id = ? AND account_id = ?').get(rescheduleId, accountId);
    if (!rsc) throw Object.assign(new Error('Pedido de alteração não encontrado.'), { status: 404, code: 'RESCHEDULE_NOT_FOUND' });
    if (rsc.status !== 'pending') {
      const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(rsc.appointment_id);
      return { reschedule: rsc, appointment: appt, idempotentReplay: true };
    }
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ? AND account_id = ?').get(rsc.appointment_id, accountId);
    const now = nowIso();

    if (decision === 'approve') {
      const targetStart = newStartAt || rsc.requested_start_at;
      const targetEnd = newEndAt || rsc.requested_end_at;
      if (!targetStart || !targetEnd) {
        throw Object.assign(new Error('Informe o novo horário confirmado para aprovar a remarcação.'), { status: 400, code: 'MISSING_NEW_SLOT' });
      }
      assertSlotAvailableTx(db, accountId, targetStart, targetEnd, appt.id);
      db.prepare(`
        UPDATE appointments SET start_at = ?, end_at = ?, status = 'confirmed', version = version + 1, updated_at = ?
        WHERE id = ?
      `).run(targetStart, targetEnd, now, appt.id);
      db.prepare(`
        UPDATE reschedule_requests SET status = 'approved', requested_start_at = ?, requested_end_at = ?, decided_by_user_id = ?, decided_at = ?, updated_at = ?
        WHERE id = ?
      `).run(targetStart, targetEnd, actorUserId, now, now, rsc.id);
    } else {
      // Declined: original appointment returns cleanly to 'confirmed' on original slot!
      db.prepare("UPDATE appointments SET status = 'confirmed', version = version + 1, updated_at = ? WHERE id = ?").run(now, appt.id);
      db.prepare("UPDATE reschedule_requests SET status = 'declined', decided_by_user_id = ?, decided_at = ?, updated_at = ? WHERE id = ?").run(actorUserId, now, now, rsc.id);
    }

    const syncEvent = recordSyncEvent(db, {
      accountId,
      eventType: decision === 'approve' ? 'appointment.reschedule_approved' : 'appointment.reschedule_declined',
      sourceProduct: 'minne',
      targetProduct: 'ambo',
      entityType: 'appointment',
      entityId: appt.id,
      payload: { rescheduleId: rsc.id, appointmentId: appt.id, decision },
    });

    writeAudit(db, { actorUserId, actorType: 'professional', accountId, action: `reschedule.${decision}`, resourceType: 'reschedule_request', resourceId: rsc.id });
    return {
      reschedule: db.prepare('SELECT * FROM reschedule_requests WHERE id = ?').get(rsc.id),
      appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(appt.id),
      syncEvent,
      idempotentReplay: false,
    };
  });
}

export function cancelAppointmentTx(db, { accountId, appointmentId, actorType, actorUserId = null, patientId = null, reason = '' }) {
  return runTransaction(db, () => {
    const appt = patientId
      ? db.prepare('SELECT * FROM appointments WHERE id = ? AND account_id = ? AND patient_id = ?').get(appointmentId, accountId, patientId)
      : db.prepare('SELECT * FROM appointments WHERE id = ? AND account_id = ?').get(appointmentId, accountId);
    if (!appt) throw Object.assign(new Error('Consulta não encontrada.'), { status: 404, code: 'APPOINTMENT_NOT_FOUND' });
    if (appt.status === 'cancelled') return { appointment: appt, idempotentReplay: true };

    const now = nowIso();
    db.prepare(`
      UPDATE appointments SET status = 'cancelled', cancelled_by = ?, cancel_reason = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `).run(actorType, reason || '', now, appt.id);
    db.prepare("UPDATE reschedule_requests SET status = 'cancelled', updated_at = ? WHERE appointment_id = ? AND status = 'pending'").run(now, appt.id);

    const syncEvent = recordSyncEvent(db, {
      accountId,
      eventType: 'appointment.cancelled',
      sourceProduct: actorType === 'patient' ? 'ambo' : 'minne',
      targetProduct: actorType === 'patient' ? 'minne' : 'ambo',
      entityType: 'appointment',
      entityId: appt.id,
      payload: { appointmentId: appt.id, cancelledBy: actorType, slotReleased: appt.start_at },
    });

    writeAudit(db, { actorUserId, actorType, accountId, action: 'appointment.cancel', resourceType: 'appointment', resourceId: appt.id });
    return { appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(appt.id), syncEvent, idempotentReplay: false };
  });
}
