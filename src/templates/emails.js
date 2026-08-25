import config from '../config.js';

/**
 * Email bodies, transcribed from
 * "Post Fair/Event Lead Flow — Email Sequence".
 *
 * Each builder returns { subject, text, html } given the lead's merge fields.
 * We render inline HTML (no SendGrid dynamic template required) so the flow
 * works end-to-end as soon as an API key + verified sender are set. If you
 * later prefer SendGrid dynamic templates, swap channels/email.js to pass
 * templateId + dynamicTemplateData instead.
 */

const CTA = () => config.content.consultationUrl;
const WEB = () => config.content.websiteUrl;
const BROCHURE = () => config.content.brochureLink;

// Small helpers -------------------------------------------------------------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );

const button = (label, url) =>
  `<p style="margin:24px 0;">
     <a href="${esc(url)}"
        style="background:#1a73e8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600;">
       ${esc(label)}
     </a>
   </p>`;

const wrap = (inner) => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#202124;max-width:600px;margin:0 auto;">
    ${inner}
    <hr style="border:none;border-top:1px solid #eee;margin:28px 0;">
    <p style="color:#5f6368;font-size:13px;">Warmly,<br>CreatED Team<br>
      <a href="${esc(WEB())}" style="color:#1a73e8;">${esc(
  WEB().replace(/^https?:\/\//, '')
)}</a>
    </p>
  </div>`;

const p = (t) => `<p>${t}</p>`;

// ── Email 1 — Immediate Follow-Up ─────────────────────────────────────────
export function email1(lead) {
  const eventName = lead.event_name || 'the event';
  const parent = lead.parent_name || 'there';
  const student = lead.student_name || 'your child';

  const subject = `Lovely meeting you at ${eventName}`;

  const text = `Hi ${parent},

It was lovely meeting you at ${eventName}.

At CreatED, we work with students in Grades 8–12 to take an interest they already have and turn it into something tangible — whether that is a prototype, research study, app, product, experiment or competition-ready project.

Rather than enrolling students into a predetermined course, we begin by understanding the student: what they are interested in, what they have already done and what they would genuinely be excited to build.

You can explore some of our student work here: ${BROCHURE()}

If you'd like to discuss what this could look like for ${student}, you can book a consultation with our team here:
Book a Consultation: ${CTA()}

Warmly,
CreatED Team
${WEB()}`;

  const html = wrap(
    p(`Hi ${esc(parent)},`) +
      p(`It was lovely meeting you at <strong>${esc(eventName)}</strong>.`) +
      p(
        `At CreatED, we work with students in Grades 8–12 to take an interest they already have and turn it into something tangible — whether that is a prototype, research study, app, product, experiment or competition-ready project.`
      ) +
      p(
        `Rather than enrolling students into a predetermined course, we begin by understanding the student: what they are interested in, what they have already done and what they would genuinely be excited to build.`
      ) +
      p(
        `You can explore some of our student work here: <a href="${esc(
          BROCHURE()
        )}">${esc(BROCHURE())}</a>`
      ) +
      p(
        `If you'd like to discuss what this could look like for <strong>${esc(
          student
        )}</strong>, you can book a consultation with our team here:`
      ) +
      button('Book a Consultation', CTA())
  );

  return { subject, text, html };
}

// ── Email 2 — Ivy League Project Case Studies (Day 2) ─────────────────────
export function email2(lead) {
  const name = lead.student_name || lead.parent_name || 'there';
  const student = lead.student_name || 'your child';

  const subject =
    'Ivy League Project Case Studies: UPenn, Yale, Brown, Dartmouth';

  const cases = [
    {
      who: 'Angad Tathgir | University of Pennsylvania',
      start:
        'Angad volunteered with a nonprofit that collected and recycled e-waste.',
      did: 'Built a zero-emission refrigerator using discarded MRI magnets.',
      outcome: 'IRIS Top 100, IEEE publication, Diana Award, BeVisioneers Fellowship.',
    },
    {
      who: 'Samaya Vaidya | Yale',
      start: 'Samaya experienced fatigue and low energy due to Thalassemia.',
      did: 'Built a bioinformatics pipeline to identify an iron supplement formulation as an opportunity for new treatments for Thalassemia.',
      outcome: 'IJHSR publication, S.T. Yau.',
    },
    {
      who: 'Samaira Mohunta | Brown',
      start: 'Samaira saw students at government schools struggling without desks.',
      did: 'Built a school bag that converts into a functional desk for government schools with poor infrastructure.',
      outcome: 'CREST Gold Award.',
    },
    {
      who: 'Jiana Shroff | Dartmouth',
      start: 'A national-level sailor wanted to optimise sailboat performance.',
      did: 'Conducted research on optimising sailboat design and performance.',
      outcome:
        'S.T. Yau Top 10; only Indian female finalist invited to Hong Kong.',
    },
  ];

  const text =
    `Hi ${name},

A project makes the Ivy League cut when a student takes an initial idea and keeps pushing it further.

Here are a few examples of what that process can look like at CreatED:

` +
    cases
      .map(
        (c) =>
          `${c.who}\nStarting point: ${c.start}\nWhat he/she did: ${c.did}\nOutcome: ${c.outcome}`
      )
      .join('\n\n') +
    `

What these projects have in common isn't that they started with perfect ideas. They started with students who were curious about something and willing to explore it seriously.

Our role is to provide the structure, mentorship and technical direction to help them take that curiosity further.

If you'd like to explore what this could look like for ${student}, we'd be happy to have an initial conversation.

Book a Project Consultation: ${CTA()}

Warmly,
CreatED Team
${WEB()}`;

  const caseHtml = cases
    .map(
      (c) => `
      <div style="margin:18px 0;padding:14px 16px;border:1px solid #eee;border-radius:8px;">
        <p style="margin:0 0 6px;font-weight:600;">${esc(c.who)}</p>
        <p style="margin:0 0 4px;"><em>Starting point:</em> ${esc(c.start)}</p>
        <p style="margin:0 0 4px;"><em>What they did:</em> ${esc(c.did)}</p>
        <p style="margin:0;"><em>Outcome:</em> ${esc(c.outcome)}</p>
      </div>`
    )
    .join('');

  const html = wrap(
    p(`Hi ${esc(name)},`) +
      p(
        `A project makes the Ivy League cut when a student takes an initial idea and keeps pushing it further.`
      ) +
      p(`Here are a few examples of what that process can look like at CreatED:`) +
      caseHtml +
      p(
        `What these projects have in common isn't that they started with perfect ideas. They started with students who were curious about something and willing to explore it seriously.`
      ) +
      p(
        `Our role is to provide the structure, mentorship and technical direction to help them take that curiosity further.`
      ) +
      p(
        `If you'd like to explore what this could look like for <strong>${esc(
          student
        )}</strong>, we'd be happy to have an initial conversation.`
      ) +
      button('Book a Project Consultation', CTA())
  );

  return { subject, text, html };
}

// ── Email 3 — Final Follow-Up (Day 5) ─────────────────────────────────────
export function email3(lead) {
  const parent = lead.parent_name || 'there';
  const student = lead.student_name || 'your child';
  const eventName = lead.event_name || 'the event';

  const subject = `What could ${student} build?`;

  const bullets = [
    `${student}'s interests and academic direction`,
    'Previous projects and extracurricular work',
    'Current grade and available timeline',
    'Potential project, research and competition pathways',
  ];

  const text = `Hi ${parent},

Just following up after ${eventName}.

The first step at CreatED is not choosing a fixed course or predetermined project. We begin by understanding the student's interests, intended academic direction and previous experiences, and then identify what they could realistically build, research or take into competitions.

On an initial consultation, our team can look at:
${bullets.map((b) => `- ${b}`).join('\n')}

If you'd like to explore what could make sense for ${student}, you can book a consultation here:
Book a Consultation: ${CTA()}

Warmly,
CreatED Team
${WEB()}`;

  const html = wrap(
    p(`Hi ${esc(parent)},`) +
      p(`Just following up after <strong>${esc(eventName)}</strong>.`) +
      p(
        `The first step at CreatED is not choosing a fixed course or predetermined project. We begin by understanding the student's interests, intended academic direction and previous experiences, and then identify what they could realistically build, research or take into competitions.`
      ) +
      p(`On an initial consultation, our team can look at:`) +
      `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` +
      p(
        `If you'd like to explore what could make sense for <strong>${esc(
          student
        )}</strong>, you can book a consultation here:`
      ) +
      button('Book a Consultation', CTA())
  );

  return { subject, text, html };
}

export const emailBuilders = { email1, email2, email3 };
