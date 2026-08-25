import config from '../config.js';
import logger from '../logger.js';
import { insertTask, markTaskSent, markTaskError, getLead } from '../db.js';
import { sendWhatsApp } from '../channels/whatsapp.js';
import { sendEmail } from '../channels/email.js';
import { whatsapp1, whatsapp2 } from '../templates/whatsapp.js';
import { email1, email2, email3 } from '../templates/emails.js';

const minutesFromNow = (m) =>
  new Date(Date.now() + m * 60 * 1000).toISOString();

/**
 * The follow-up plan, straight from the Tech Requirements doc:
 *
 *   Day 0 (immediate): WhatsApp 1 + Email 1
 *   Day 2:             WhatsApp 2 + Email 2   (skip WhatsApp 2 if booked)
 *   Day 5:             Email 3
 *
 * Stop conditions (consultation booked / opted out / closed) are enforced by
 * the scheduler query and re-checked at send time.
 */
export async function enrollLead(lead) {
  const now = new Date().toISOString();
  // Day 0 — send immediately (due "now").
  await insertTask(lead.id, 'wa1', 'whatsapp', now);
  await insertTask(lead.id, 'email1', 'email', now);

  // Day 2 (DELAY_MINUTES_DAY2 / DELAY_HOURS_DAY2).
  const day2 = minutesFromNow(config.timing.day2Minutes);
  await insertTask(lead.id, 'wa2', 'whatsapp', day2);
  await insertTask(lead.id, 'email2', 'email', day2);

  // Day 5 (DELAY_MINUTES_DAY5 / DELAY_HOURS_DAY5).
  const day5 = minutesFromNow(config.timing.day5Minutes);
  await insertTask(lead.id, 'email3', 'email', day5);

  logger.info('Lead enrolled in sequence', {
    leadId: lead.id,
    event: lead.event_name,
    day2Due: day2,
    day5Due: day5,
  });
}

/**
 * Execute a single task row. Returns a result or throws on send failure so the
 * scheduler can record the error and retry later.
 */
export async function dispatchTask(task) {
  const lead = await getLead(task.lead_id);
  if (!lead) throw new Error(`Lead ${task.lead_id} not found`);

  // Re-check stop conditions at send time (belt and braces).
  if (lead.opted_out || lead.closed) {
    logger.info('Skipping task — lead stopped', {
      taskId: task.id,
      type: task.type,
      reason: lead.opted_out ? 'opted_out' : 'closed',
    });
    await markTaskSent(task.id); // mark done so it is not retried
    return { skipped: true };
  }

  // WhatsApp 2 and Email 2/3 are "booking" nudges — do not send once booked.
  const bookingNudge = ['wa2', 'email2', 'email3'].includes(task.type);
  if (bookingNudge && lead.consultation_booked) {
    logger.info('Skipping booking nudge — consultation already booked', {
      taskId: task.id,
      type: task.type,
    });
    await markTaskSent(task.id);
    return { skipped: true };
  }

  switch (task.type) {
    case 'wa1':
      await sendWhatsApp(lead.parent_phone, whatsapp1(lead));
      break;
    case 'wa2':
      await sendWhatsApp(lead.parent_phone, whatsapp2(lead));
      break;
    case 'email1':
      await sendEmail(lead.parent_email, email1(lead));
      break;
    case 'email2':
      // Doc addresses Email 2 to "Student/Parent" — prefer parent, fall back.
      await sendEmail(lead.parent_email || lead.student_email, email2(lead));
      break;
    case 'email3':
      await sendEmail(lead.parent_email, email3(lead));
      break;
    default:
      throw new Error(`Unknown task type: ${task.type}`);
  }

  await markTaskSent(task.id);
  return { sent: true };
}

export async function safeDispatch(task) {
  try {
    return await dispatchTask(task);
  } catch (err) {
    logger.error('Task dispatch failed', {
      taskId: task.id,
      type: task.type,
      error: err.message,
    });
    await markTaskError(task.id, err.message);
    return { error: err.message };
  }
}
