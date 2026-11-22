import { nowIso, randomId } from './crypto.mjs';
import { isRemoteInfraRequired } from './db.mjs';

/**
 * Pluggable transactional email transport.
 * - Uses Resend HTTPS API when RESEND_API_KEY + RESEND_FROM_EMAIL are configured on the server.
 * - Refuses silent fallback to local outbox when remote delivery infra is required (ENOMERA_REQUIRE_REMOTE_INFRA=true).
 * - Falls back honestly to local homologation outbox (dev_outbox_messages) only in local dev/tests.
 */
export function getMailerStatus() {
  const hasKey = Boolean(process.env.RESEND_API_KEY);
  const hasFrom = Boolean(process.env.RESEND_FROM_EMAIL);
  const configured = hasKey && hasFrom;
  const remoteRequired = isRemoteInfraRequired();
  const missingEnvVars = [];
  if (!hasKey) missingEnvVars.push('RESEND_API_KEY');
  if (!hasFrom) missingEnvVars.push('RESEND_FROM_EMAIL');
  const allowlistCount = (process.env.RESEND_TEST_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean).length;
  return {
    provider: configured
      ? 'resend'
      : remoteRequired
        ? 'unconfigured_remote_required'
        : 'local_homologation_outbox',
    configured,
    fromConfigured: hasFrom,
    remoteRequired,
    missingEnvVars,
    allowlistActive: allowlistCount > 0,
    allowlistCount,
  };
}

export async function sendTransactionalEmail(db, { recipient, subject, textBody, htmlBody, purpose, channel = 'email' }) {
  const id = randomId('msg');
  const createdAt = nowIso();
  const apiKey = process.env.RESEND_API_KEY || '';
  const fromEmail = process.env.RESEND_FROM_EMAIL || '';
  const remoteRequired = isRemoteInfraRequired();

  if (remoteRequired && (!apiKey || !fromEmail)) {
    const missingEnvVars = [];
    if (!apiKey) missingEnvVars.push('RESEND_API_KEY');
    if (!fromEmail) missingEnvVars.push('RESEND_FROM_EMAIL');
    throw Object.assign(
      new Error(`Canal de envio transacional (Resend) não configurado neste ambiente de entrega. Defina ${missingEnvVars.join(' e ')} no ambiente Preview da Vercel.`),
      {
        status: 503,
        code: 'REMOTE_MAILER_NOT_CONFIGURED',
        missingEnvVars,
      }
    );
  }
  const allowlist = (process.env.RESEND_TEST_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const canSendViaResend =
    channel === 'email' &&
    Boolean(apiKey && fromEmail) &&
    (allowlist.length === 0 || allowlist.includes(recipient.trim().toLowerCase()));

  let deliveryStatus = 'not_configured_local_outbox';
  let providerId = null;
  let notice =
    'Canal de envio real (Resend/SMTP) não configurado neste ambiente. Nenhuma mensagem externa foi disparada; o código foi registrado apenas na caixa local de homologação.';

  if (canSendViaResend) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [recipient],
          subject,
          text: textBody,
          html: htmlBody || `<p>${textBody}</p>`,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json.id) {
        deliveryStatus = 'sent_resend';
        providerId = json.id;
        notice = `Código enviado para ${recipient}. Se não chegar em até 2 minutos, confira o spam ou clique em Reenviar código.`;
      } else {
        deliveryStatus = 'provider_error_fallback_local';
        notice = `Falha no envio via Resend (${json.message || resp.status}). Código mantido na caixa local de homologação como alternativa.`;
      }
    } catch (err) {
      deliveryStatus = 'provider_error_fallback_local';
      notice = `Erro de rede ao contatar Resend (${err.message}). Código mantido na caixa local de homologação como alternativa.`;
    }
  } else if (apiKey && fromEmail && allowlist.length > 0 && !allowlist.includes(recipient.trim().toLowerCase())) {
    deliveryStatus = 'blocked_by_test_allowlist_local';
    notice = `Destinatário ${recipient} fora da lista controlada de homologação (RESEND_TEST_ALLOWLIST). Código disponível apenas na caixa local.`;
  }

  // Never store plaintext OTPs/tokens in dev_outbox_messages when real external Resend delivery succeeded
  const storedPreview = deliveryStatus === 'sent_resend'
    ? '[Enviado externamente via Resend — conteúdo oculto da caixa local por segurança]'
    : textBody;

  await db.run(
    `INSERT INTO dev_outbox_messages (id, channel, recipient, subject, body_preview, purpose, delivery_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, channel, recipient, subject, storedPreview, purpose, deliveryStatus, createdAt
  );

  return {
    id,
    recipient,
    deliveryStatus,
    providerId,
    sentExternally: deliveryStatus === 'sent_resend',
    notice,
    delayGuidance: 'Se demorar mais de 60 segundos, verifique a pasta de spam, corrija o endereço acima ou solicite reenvio.',
  };
}
