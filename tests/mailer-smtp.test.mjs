import assert from 'node:assert/strict';
import test from 'node:test';
import { getMailerStatus, getSmtpConfig, sendTransactionalEmail, __setSmtpTransportForTests } from '../server/mailer.mjs';

function fakeDb() {
  const rows = [];
  return { rows, run: async (_sql, ...args) => { rows.push(args); } };
}

test('SMTP (Gmail) tem prioridade, oculta o código na caixa local e marca envio externo', async () => {
  const prev = { ...process.env };
  try {
    delete process.env.ENOMERA_REQUIRE_REMOTE_INFRA;
    delete process.env.VERCEL;
    process.env.SMTP_USER = 'piloto@example.com';
    process.env.SMTP_PASSWORD = 'abcd efgh ijkl mnop';
    process.env.RESEND_API_KEY = 're_x';
    process.env.RESEND_FROM_EMAIL = 'x@resend.dev';
    const cfg = getSmtpConfig();
    assert.equal(cfg.pass, 'abcdefghijklmnop');
    assert.equal(cfg.host, 'smtp.gmail.com');
    assert.equal(cfg.from, 'Enomera <piloto@example.com>');
    assert.equal(getMailerStatus().provider, 'smtp');

    const sent = [];
    __setSmtpTransportForTests({ sendMail: async (m) => { sent.push(m); return { messageId: '<id@x>' }; } });
    const db = fakeDb();
    const out = await sendTransactionalEmail(db, { recipient: 'ana@example.com', subject: 'Código', textBody: 'Seu código: 123456', purpose: 'signup' });
    assert.equal(out.deliveryStatus, 'sent_smtp');
    assert.equal(out.sentExternally, true);
    assert.equal(sent[0].to, 'ana@example.com');
    assert.ok(!JSON.stringify(db.rows).includes('123456'));

    __setSmtpTransportForTests({ sendMail: async () => { throw Object.assign(new Error('auth'), { responseCode: 535 }); } });
    const fail = await sendTransactionalEmail(fakeDb(), { recipient: 'ana@example.com', subject: 'Código', textBody: 'Seu código: 654321', purpose: 'signup' });
    assert.equal(fail.deliveryStatus, 'provider_error_fallback_local');
    assert.equal(fail.sentExternally, false);
    assert.match(fail.notice, /535/);
  } finally {
    __setSmtpTransportForTests(null);
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
    Object.assign(process.env, prev);
  }
});
