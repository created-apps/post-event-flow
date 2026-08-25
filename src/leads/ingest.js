import logger from '../logger.js';
import {
  insertLead,
  getLeadByExternalId,
  getConfig,
} from '../db.js';
import { enrollLead } from './sequence.js';

/**
 * Map a form-response payload (sent by Apps Script) into a normalised lead.
 *
 * Apps Script sends field labels as keys. Because form wording can vary, we
 * match on a set of aliases per field rather than exact labels. The event name
 * is expected in the payload (Apps Script stamps it from the form title); if it
 * is missing we fall back to the last event set via Slack.
 */
const ALIASES = {
  student_name: ['student name', 'student full name', 'name of student'],
  student_email: ['student email', 'student e-mail'],
  student_phone: ['student phone', 'student phone number', 'student mobile'],
  school: ['school', 'school name', 'current school'],
  grade: ['grade', 'grade / graduation year', 'graduation year', 'grade/graduation year', 'class'],
  parent_name: ['parent name', 'parent full name', 'name of parent', 'guardian name'],
  parent_email: ['parent email', 'parent e-mail', 'guardian email'],
  parent_phone: ['parent phone', 'parent phone number', 'parent mobile', 'guardian phone'],
  interests: ['student interests / notes', 'student interests', 'interests', 'notes', 'interests / notes'],
  event_name: ['event name', 'event'],
  event_city: ['event city', 'city'],
  event_date: ['event date', 'date'],
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function pick(answers, field) {
  const wanted = ALIASES[field] || [field];
  // Build a normalised lookup once.
  for (const [k, v] of Object.entries(answers)) {
    const nk = norm(k);
    if (wanted.some((w) => nk === norm(w) || nk.includes(norm(w)))) {
      return typeof v === 'string' ? v.trim() : v;
    }
  }
  return null;
}

/**
 * @param {object} payload  { external_id, event_name?, answers: {label: value} }
 * @returns {{ created: boolean, lead: object }}
 */
export async function ingestResponse(payload) {
  const answers = payload.answers || payload.fields || {};
  const externalId =
    payload.external_id || payload.responseId || payload.id || null;

  // Idempotency: never double-enroll the same response.
  if (externalId) {
    const existing = await getLeadByExternalId(externalId);
    if (existing) {
      logger.info('Duplicate form response ignored', { externalId });
      return { created: false, lead: existing };
    }
  }

  const eventName =
    payload.event_name ||
    pick(answers, 'event_name') ||
    (await getConfig('current_event_name')) ||
    null;

  const lead = await insertLead({
    external_id: externalId,
    event_name: eventName,
    event_city: payload.event_city || pick(answers, 'event_city'),
    event_date: payload.event_date || pick(answers, 'event_date'),
    student_name: pick(answers, 'student_name'),
    student_email: pick(answers, 'student_email'),
    student_phone: pick(answers, 'student_phone'),
    school: pick(answers, 'school'),
    grade: pick(answers, 'grade'),
    parent_name: pick(answers, 'parent_name'),
    parent_email: pick(answers, 'parent_email'),
    parent_phone: pick(answers, 'parent_phone'),
    interests: pick(answers, 'interests'),
    raw: JSON.stringify(payload),
  });

  logger.info('Lead ingested', {
    leadId: lead.id,
    event: lead.event_name,
    parent: lead.parent_name,
  });

  await enrollLead(lead);
  return { created: true, lead };
}
