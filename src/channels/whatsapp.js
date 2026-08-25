import twilio from 'twilio';
import config from '../config.js';
import logger from '../logger.js';

let client = null;
if (config.ready.twilio) {
  client = twilio(config.twilio.accountSid, config.twilio.authToken);
} else {
  logger.warn('Twilio not configured — WhatsApp sends will be logged, not sent.');
}

const toWhatsApp = (phone) => {
  const raw = String(phone || '').trim();
  if (!raw) return null;
  if (raw.startsWith('whatsapp:')) return raw;
  // Ensure E.164-ish (leading +). We do not attempt full normalisation here;
  // Twilio rejects malformed numbers and we record the error on the task.
  const digits = raw.replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+') ? digits : `+${digits}`;
  return `whatsapp:${e164}`;
};

/**
 * Send a WhatsApp message.
 * @param {string} toPhone      recipient phone (parent phone)
 * @param {object} msg          from templates/whatsapp.js
 * @returns {Promise<{sid?:string, dryRun?:boolean}>}
 */
export async function sendWhatsApp(toPhone, msg) {
  const to = toWhatsApp(toPhone);
  if (!to) throw new Error('Missing/invalid recipient phone for WhatsApp');

  // Dry-run when Twilio isn't wired up yet.
  if (!client) {
    logger.info('[DRY-RUN] WhatsApp', {
      from: toWhatsApp(config.twilio.whatsappFrom),
      to,
      contentSid: msg.contentSid || null,
      preview: msg.body?.slice(0, 80),
    });
    return { dryRun: true };
  }

  // Normalise the sender too: Twilio rejects the pair with "Invalid From and To
  // pair" (21910) if one side carries the whatsapp: prefix and the other doesn't.
  const from = toWhatsApp(config.twilio.whatsappFrom);
  if (!from) throw new Error('TWILIO_WHATSAPP_FROM is not set');

  const params = { from, to };

  // Prefer an approved Content template (required for business-initiated msgs).
  const hasTemplate = msg.contentSid && !msg.contentSid.includes('<');
  if (hasTemplate) {
    params.contentSid = msg.contentSid;
    if (msg.contentVariables) {
      params.contentVariables = JSON.stringify(msg.contentVariables);
    }
  } else {
    // Fallback: free-form body (valid only inside the 24h window / sandbox).
    logger.warn(
      'No approved Content SID for this WhatsApp message — sending free-form body (sandbox/session only).'
    );
    params.body = msg.body;
    if (msg.mediaUrl) params.mediaUrl = [msg.mediaUrl];
  }

  const res = await client.messages.create(params);
  logger.info('WhatsApp sent', { to, sid: res.sid, status: res.status });
  return { sid: res.sid };
}

export default { sendWhatsApp };
