import nodemailer from 'nodemailer';
import { nowIso, randomId } from './crypto.mjs';
import { isRemoteInfraRequired } from './db.mjs';

/**
 * SMTP (Gmail com senha de app) é o canal gratuito do piloto: entrega para qualquer
 * destinatário sem domínio próprio. Ativo quando SMTP_USER + SMTP_PASSWORD existem.
 * Tem prioridade sobre o Resend, que sem domínio verificado só entrega ao dono da conta.
 */
export function getSmtpConfig() {
  // Remetente do piloto definido por Marcos em 22/11: o Gmail de trabalho dele.
  const user = (process.env.SMTP_USER || 'mrsaocwork@gmail.com').trim();
  const pass = (process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) return null;
  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    user,
    pass,
    from: process.env.SMTP_FROM || `Enomera <${user}>`,
  };
}

let smtpTransport = null;
function getSmtpTransport(cfg) {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return smtpTransport;
}

/** Para testes: permite injetar um transporte falso. */
export function __setSmtpTransportForTests(t) { smtpTransport = t; }

/**
 * Pluggable transactional email transport.
 * - Uses SMTP (Gmail app password) when SMTP_USER + SMTP_PASSWORD are set; otherwise Resend HTTPS API when RESEND_API_KEY + RESEND_FROM_EMAIL are set.
 * - Refuses silent fallback to local outbox when remote delivery infra is required (ENOMERA_REQUIRE_REMOTE_INFRA=true).
 * - Falls back honestly to local homologation outbox (dev_outbox_messages) only in local dev/tests.
 */
export function getMailerStatus() {
  const smtp = getSmtpConfig();
  const hasKey = Boolean(process.env.RESEND_API_KEY);
  const hasFrom = Boolean(process.env.RESEND_FROM_EMAIL);
  const resendConfigured = hasKey && hasFrom;
  const configured = Boolean(smtp) || resendConfigured;
  const remoteRequired = isRemoteInfraRequired();
  const missingEnvVars = [];
  if (!configured) {
    missingEnvVars.push('SMTP_PASSWORD');
  }
  const allowlistCount = (process.env.RESEND_TEST_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean).length;
  return {
    provider: smtp
      ? 'smtp'
      : resendConfigured
        ? 'resend'
        : remoteRequired
        ? 'unconfigured_remote_required'
        : 'local_homologation_outbox',
    configured,
    fromConfigured: Boolean(smtp) || hasFrom,
    smtpConfigured: Boolean(smtp),
    resendConfigured,
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
  const smtp = channel === 'email' ? getSmtpConfig() : null;

  if (remoteRequired && !smtp && (!apiKey || !fromEmail)) {
    const missingEnvVars = ['SMTP_PASSWORD'];
    throw Object.assign(
      new Error(`Canal de envio de e-mail não configurado neste ambiente. Defina ${missingEnvVars.join(' e ')} no ambiente Preview da Vercel.`),
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
    !smtp &&
    channel === 'email' &&
    Boolean(apiKey && fromEmail) &&
    (allowlist.length === 0 || allowlist.includes(recipient.trim().toLowerCase()));

  let deliveryStatus = 'not_configured_local_outbox';
  let providerId = null;
  let notice =
    'Canal de envio real (Resend/SMTP) não configurado neste ambiente. Nenhuma mensagem externa foi disparada; o código foi registrado apenas na caixa local de homologação.';

  if (smtp) {
    try {
      const info = await getSmtpTransport(smtp).sendMail({
        from: smtp.from,
        to: recipient,
        subject,
        text: textBody,
        html: htmlBody || `<p>${textBody}</p>`,
      });
      deliveryStatus = 'sent_smtp';
      providerId = info?.messageId || null;
      notice = `Código enviado para ${recipient}. Se não chegar em até 2 minutos, confira o spam ou clique em Reenviar código.`;
    } catch (err) {
      deliveryStatus = 'provider_error_fallback_local';
      notice = `Falha no envio do e-mail (${err.responseCode || err.code || 'erro'}). Código mantido na caixa local de homologação como alternativa.`;
    }
  } else if (canSendViaResend) {
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

  const sentExternally = deliveryStatus === 'sent_resend' || deliveryStatus === 'sent_smtp';
  if (remoteRequired && !sentExternally) {
    throw Object.assign(new Error('Não foi possível entregar o e-mail. Seus dados foram preservados. Confira o endereço e solicite um novo envio.'),
      { status:503, code:'MAIL_DELIVERY_FAILED' });
  }

  // Never store plaintext OTPs/tokens in dev_outbox_messages when real external Resend delivery succeeded
  const storedPreview = sentExternally
    ? '[Enviado externamente — conteúdo oculto da caixa local por segurança]'
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
    sentExternally,
    notice,
    delayGuidance: 'Se demorar mais de 60 segundos, verifique a pasta de spam, corrija o endereço acima ou solicite reenvio.',
  };
}
