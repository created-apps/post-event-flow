import config from '../config.js';

/**
 * WhatsApp message bodies, transcribed from
 * "Post Fair/Event Lead Flow — Twilio WhatsApp Messages".
 *
 * IMPORTANT: business-initiated WhatsApp messages (which these are — we message
 * the parent first) must be sent from a pre-approved Content template, not as
 * free-form text. So at send time we use Twilio Content API `contentSid` +
 * `contentVariables`. The plain-text below is:
 *   1) the exact copy to submit for template approval (see docs/SETUP.md), and
 *   2) a fallback body used only for the WhatsApp sandbox / local dry-runs,
 *      where free-form text is allowed.
 *
 * The `{{1}}`, `{{2}}` in the template correspond to the ordered variables the
 * approved template expects. We map them here so both stay in sync.
 */

const CTA = () => config.content.consultationUrl;

// ── WhatsApp 1 — Immediate Follow-Up ──────────────────────────────────────
export function whatsapp1(lead) {
  const parent = lead.parent_name || 'there';
  const student = lead.student_name || 'your child';
  const eventName = lead.event_name || 'the event';

  // Fallback free-form text (sandbox / dry-run only).
  const body = `Hi ${parent}, it was lovely meeting you at ${eventName}!

At CreatED, we work with students in Grades 8–12 to turn their interests into ambitious projects, research papers and competition-ready work.

If you'd like to explore what could make sense specifically for ${student}, you can book a consultation with our team here:

Book a Consultation:
${CTA()}

– Team CreatED`;

  // Ordered variables for the approved Content template WA1.
  // Template body (submit this):
  //   Hi {{1}}, it was lovely meeting you at {{2}}!
  //   At CreatED, we work with students in Grades 8–12 to turn their interests
  //   into ambitious projects, research papers and competition-ready work.
  //   If you'd like to explore what could make sense specifically for {{3}},
  //   you can book a consultation with our team here:
  //   Book a Consultation: {{4}}
  //   – Team CreatED
  const contentVariables = {
    1: parent,
    2: eventName,
    3: student,
    4: CTA(),
  };

  return {
    contentSid: config.twilio.contentSidWa1,
    contentVariables,
    body,
  };
}

// ── WhatsApp 2 — Follow-Up (Day 2; skip if consultation booked) ────────────
export function whatsapp2(lead) {
  const parent = lead.parent_name || 'there';
  const student = lead.student_name || 'your child';
  const eventName = lead.event_name || 'the event';

  const body = `Hi ${parent}, just following up after ${eventName}.

At CreatED, students don't start with a predetermined project. We look at their interests, academic direction and previous experiences, and then help them identify something genuinely worth building or researching.

If you'd like us to explore potential directions for ${student}, you can book an initial consultation here:

Book a Consultation:
${CTA()}

– Team CreatED`;

  // Template body (submit this):
  //   Hi {{1}}, just following up after {{2}}.
  //   At CreatED, students don't start with a predetermined project. We look at
  //   their interests, academic direction and previous experiences, and then
  //   help them identify something genuinely worth building or researching.
  //   If you'd like us to explore potential directions for {{3}}, you can book
  //   an initial consultation here:
  //   Book a Consultation: {{4}}
  //   – Team CreatED
  const contentVariables = {
    1: parent,
    2: eventName,
    3: student,
    4: CTA(),
  };

  return {
    contentSid: config.twilio.contentSidWa2,
    contentVariables,
    body,
    mediaUrl: undefined,
  };
}

export const whatsappBuilders = { whatsapp1, whatsapp2 };
