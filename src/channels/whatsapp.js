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
 * The sender half of the request. Twilio takes either a From address or a
 * Messaging Service SID, not necessarily both — with a Messaging Service it
 * picks the WhatsApp sender out of the service's pool, which avoids having to
 * name (and keep in sync) a specific whatsapp: address here.
 *
 * Messaging Service wins when both are set.
 */
function sender() {
  const { messagingServiceSid, whatsappFrom } = config.twilio;
  if (messagingServiceSid && !messagingServiceSid.includes('<')) {
    return { messagingServiceSid };
  }
  if (whatsappFrom === 'whatsapp:+14155238886') {
    logger.warn(
      'Using the Twilio WhatsApp sandbox sender — the recipient must have joined ' +
        'the sandbox. Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_WHATSAPP_FROM for production.'
    );
  }
  // Same channel on both sides, or Twilio rejects the pair with 21910.
  const from = toWhatsApp(whatsappFrom);
  if (!from) {
    throw new Error(
      'No WhatsApp sender configured — set TWILIO_MESSAGING_SERVICE_SID or TWILIO_WHATSAPP_FROM'
    );
  }
  return { from };
}

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
      ...sender(),
      to,
      contentSid: msg.contentSid || null,
      preview: msg.body?.slice(0, 80),
    });
    return { dryRun: true };
  }

  const params = { to, ...sender() };

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
