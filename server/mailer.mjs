import nodemailer from 'nodemailer';
import { nowIso, randomId } from './crypto.mjs';
import { isRemoteInfraRequired } from './db.mjs';

/**
 * SMTP (Gmail com senha de app) é o canal gratuito do piloto: entrega para qualquer
 * destinatário sem domínio próprio. Ativo quando SMTP_USER + SMTP_PASSWORD existem.
 * Tem prioridade sobre o Resend, que sem domínio verificado só entrega ao dono da conta.
 */
// Remetente provisório do piloto (definido por Marcos em 22/11). Único lugar do código com este
// endereço: sai daqui quando existir domínio próprio com SPF/DKIM (RESEND_FROM_EMAIL no domínio
// da Enomera, que então passa a ter prioridade) ou quando SMTP_USER/ENOMERA_CONTACT_EMAIL forem definidos.
const PILOT_FALLBACK_SENDER = 'mrsaocwork@gmail.com';

/** E-mail de contato/operacional da Enomera, vindo do ambiente sempre que possível. */
export function contactEmail() {
  return (process.env.ENOMERA_CONTACT_EMAIL || process.env.SMTP_USER || PILOT_FALLBACK_SENDER).trim();
}

/** Resend com domínio próprio verificado (não o endereço de teste @resend.dev). */
function resendOwnDomain() {
  const from = (process.env.RESEND_FROM_EMAIL || '').trim();
  return Boolean(process.env.RESEND_API_KEY && from && !/@resend\.dev>?$/i.test(from));
}

export function getSmtpConfig() {
  // Com domínio próprio no Resend, o envio sai pelo domínio da marca e o SMTP do Gmail fica de reserva.
  if (resendOwnDomain()) return null;
  const user = (process.env.SMTP_USER || PILOT_FALLBACK_SENDER).trim();
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

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Modelo de e-mail da marca: fundo claro, cartão branco, nome enomera e rodapé.
 * `inner` já é HTML confiável; sem ele, o texto simples é escapado e os links viram âncoras.
 */
export function brandEmailHtml({ subject = '', textBody = '', inner = '' } = {}) {
  const body = inner || String(textBody || '').split(/\n{2,}/).map((para) => {
    const safe = escHtml(para).replace(/\n/g, '<br>')
      .replace(/(https:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#5b4bd6">$1</a>');
    return `<p style="margin:0 0 14px">${safe}</p>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f4f2fb">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2fb;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;border:1px solid #e6e1f5">
<tr><td style="padding:24px 28px 0;font-family:Manrope,'Segoe UI',Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-.02em;color:#2a2440">enomera</td></tr>
<tr><td style="padding:16px 28px 24px;font-family:Manrope,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.6;color:#2a2440">
${subject ? `<h1 style="margin:0 0 14px;font-size:18px;line-height:1.35;color:#2a2440">${escHtml(subject)}</h1>` : ''}${body}</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #efeaf9;font-family:Manrope,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b6480">Enomera · Agendamento, Consultório e Site para profissionais de saúde.<br>Você recebeu este e-mail porque usa ou foi convidado a usar a Enomera. Se não reconhece este aviso, ignore-o.</td></tr>
</table></td></tr></table></body></html>`;
}

function maskEmail(value) {
  const v = String(value || '');
  const at = v.indexOf('@');
  if (at < 1) return v ? `${v.slice(0, 2)}***` : '';
  return `${v[0]}***${v.slice(at)}`;
}

const OUTBOX_RETENTION_DAYS = 30;

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
  const html = brandEmailHtml({ subject, textBody, inner: htmlBody });

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
        html,
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
          html,
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
    ? '[Enviado externamente. Conteúdo oculto da caixa local por segurança]'
    : textBody;

  // Registro mínimo: quando o e-mail saiu de verdade, guardamos só o destinatário mascarado e a
  // finalidade (sem assunto, que pode trazer nome de pessoa). Tudo é apagado depois de 30 dias.
  await db.run(
    `INSERT INTO dev_outbox_messages (id, channel, recipient, subject, body_preview, purpose, delivery_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, channel, sentExternally ? maskEmail(recipient) : recipient, sentExternally ? String(purpose || 'e-mail') : subject, storedPreview, purpose, deliveryStatus, createdAt
  );
  try {
    await db.run('DELETE FROM dev_outbox_messages WHERE created_at < ?', new Date(Date.now() - OUTBOX_RETENTION_DAYS * 86_400_000).toISOString());
  } catch { /* limpeza oportunista: nunca impede o envio */ }

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
