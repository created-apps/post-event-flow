import 'dotenv/config';

/**
 * Centralised, validated configuration.
 *
 * Nothing here throws on a missing placeholder — the app must boot with
 * placeholder credentials so it can be inspected and partially exercised
 * before the real accounts are wired in. Instead each integration reports
 * whether it is "configured", and the modules that use it degrade gracefully
 * (log + skip) when it is not.
 */

const bool = (v, dflt = false) =>
  v === undefined ? dflt : /^(1|true|yes|on)$/i.test(String(v).trim());

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

// Follow-up delay in minutes. DELAY_MINUTES_* wins when set — the testing knob,
// so you don't have to express 2 minutes as 0.0333 hours. DELAY_HOURS_* is the
// production one. Both accept fractions.
const delayMinutes = (minutesEnv, hoursEnv, dfltMinutes) => {
  // A blank value means "unset", not zero — Number('') is 0, so check first.
  const pick = (v, toMinutes) => {
    if (v === undefined || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n * toMinutes) : null;
  };
  return pick(minutesEnv, 1) ?? pick(hoursEnv, 60) ?? dfltMinutes;
};

// Twilio's shared WhatsApp sandbox sender — works on any account once the
// receiving phone has joined the sandbox. Not for production.
const SANDBOX_WHATSAPP_FROM = 'whatsapp:+14155238886';

// Channel IDs look like "C0XXXXXXX"; treat blanks and <placeholders> as unset.
const channelId = (v) => {
  const s = String(v ?? '').trim();
  return s === '' || s.includes('<') ? '' : s;
};

// A value counts as "real" if it is set and not one of our placeholder tokens.
const isReal = (v) =>
  typeof v === 'string' &&
  v.trim() !== '' &&
  !v.includes('<') &&
  !/^your-/i.test(v);

const config = {
  port: num(process.env.PORT, 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  ingestToken: process.env.INGEST_TOKEN || '',

  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || '',
    requestChannel: process.env.SLACK_FORM_REQUEST_CHANNEL || '',
    // Polling mode: pull messages with conversations.history instead of
    // receiving Event Subscriptions. Lets you test locally without a tunnel.
    poll: {
      enabled: bool(process.env.SLACK_POLL_ENABLED, false),
      channel: channelId(
        process.env.SLACK_POLL_CHANNEL || process.env.SLACK_FORM_REQUEST_CHANNEL
      ),
      intervalSeconds: Math.max(1, num(process.env.SLACK_POLL_INTERVAL_SECONDS, 5)),
      backfillSeconds: Math.max(0, num(process.env.SLACK_POLL_BACKFILL_SECONDS, 0)),
    },
  },

  google: {
    formId: process.env.GOOGLE_FORM_ID || '',
    // Two ways to supply the service-account key:
    //   • GOOGLE_CREDENTIALS_BASE64 — base64 of the whole JSON key (best for hosts)
    //   • GOOGLE_APPLICATION_CREDENTIALS — path to a JSON key file (best for local)
    credentialsBase64: process.env.GOOGLE_CREDENTIALS_BASE64 || '',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
    titlePrefix: process.env.FORM_TITLE_PREFIX ?? '',
    titleSuffix: process.env.FORM_TITLE_SUFFIX ?? '',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    // Defaults to the WhatsApp sandbox sender, so ACCOUNT_SID + AUTH_TOKEN are
    // the only two Twilio variables you must set to start sending. Twilio
    // itself always needs a sender (From or MessagingServiceSid) — this just
    // supplies one rather than making you configure it.
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || SANDBOX_WHATSAPP_FROM,
    // Alternative sender: a Messaging Service with the WhatsApp sender in its
    // pool. Takes precedence over whatsappFrom — Twilio accepts one or the
    // other, and picks the sender from the pool when From is omitted.
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
    contentSidWa1: process.env.TWILIO_CONTENT_SID_WA1 || '',
    contentSidWa2: process.env.TWILIO_CONTENT_SID_WA2 || '',
  },

  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    fromName: process.env.EMAIL_FROM_NAME || 'CreatED Team',
    bcc: process.env.EMAIL_BCC || '',
  },

  content: {
    consultationUrl:
      process.env.CONSULTATION_URL ||
      'https://www.create-ed.in/schedule-a-consultation',
    brochureLink: process.env.PROJECT_BROCHURE_LINK || 'https://www.create-ed.in',
    websiteUrl: process.env.WEBSITE_URL || 'https://www.create-ed.in',
  },

  timing: {
    day2Minutes: delayMinutes(
      process.env.DELAY_MINUTES_DAY2,
      process.env.DELAY_HOURS_DAY2,
      48 * 60
    ),
    day5Minutes: delayMinutes(
      process.env.DELAY_MINUTES_DAY5,
      process.env.DELAY_HOURS_DAY5,
      120 * 60
    ),
  },
};

// Feature-readiness flags, derived from whether real (non-placeholder) values exist.
config.ready = {
  slackReply: isReal(config.slack.botToken),
  slackPoll:
    config.slack.poll.enabled &&
    isReal(config.slack.botToken) &&
    Boolean(config.slack.poll.channel),
  googleForms:
    isReal(config.google.formId) &&
    (isReal(config.google.credentialsBase64) || isReal(config.google.credentialsPath)),
  gemini: isReal(config.gemini.apiKey),
  twilio:
    isReal(config.twilio.accountSid) &&
    isReal(config.twilio.authToken) &&
    (isReal(config.twilio.whatsappFrom) ||
      isReal(config.twilio.messagingServiceSid)),
  sendgrid: isReal(config.sendgrid.apiKey) && isReal(config.sendgrid.from),
  ingest: isReal(config.ingestToken),
  supabase: isReal(config.supabase.url) && isReal(config.supabase.serviceRoleKey),
};

export default config;
export { isReal };
