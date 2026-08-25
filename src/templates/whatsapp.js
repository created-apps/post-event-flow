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
 * Variable keys must match the names used in the approved Content template
 * EXACTLY. Twilio allows numeric ({{1}}) or alphanumeric ({{Parent_Name}})
 * keys — no spaces, 16 characters max — and any template variable missing from
 * contentVariables falls back to the template's default placeholder text. That
 * is what a message full of literal "{{Parent_Name}}" style filler means: the
 * keys we sent did not match the ones the template declares.
 */

const CTA = () => config.content.consultationUrl;

// Variable names as declared in the Twilio Content templates. Change these if
// you rename a variable in Content Template Builder.
const VAR = {
  parent: 'Parent_Name',
  event: 'Event_Name',
  student: 'Student_Name',
};

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

  // Variables for the approved Content template WA1.
  // Template body (the consultation link is hard-coded in the template, so it
  // is not a variable):
  //   Hi {{Parent_Name}}, it was lovely meeting you at {{Event_Name}}!
  //   At CreatED, we work with students in Grades 8–12 to turn their interests
  //   into ambitious projects, research papers and competition-ready work.
  //   If you'd like to explore what could make sense specifically for
  //   {{Student_Name}}, you can book a consultation with our team here:
  //   Book a Consultation: <link>
  //   – Team CreatED
  const contentVariables = {
    [VAR.parent]: parent,
    [VAR.event]: eventName,
    [VAR.student]: student,
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

  // Template body (link hard-coded in the template, as with WA1):
  //   Hi {{Parent_Name}}, just following up after {{Event_Name}}.
  //   At CreatED, students don't start with a predetermined project. We look at
  //   their interests, academic direction and previous experiences, and then
  //   help them identify something genuinely worth building or researching.
  //   If you'd like us to explore potential directions for {{Student_Name}},
  //   you can book an initial consultation here:
  //   Book a Consultation: <link>
  //   – Team CreatED
  const contentVariables = {
    [VAR.parent]: parent,
    [VAR.event]: eventName,
    [VAR.student]: student,
  };

  return {
    contentSid: config.twilio.contentSidWa2,
    contentVariables,
    body,
    mediaUrl: undefined,
  };
}

export const whatsappBuilders = { whatsapp1, whatsapp2 };
