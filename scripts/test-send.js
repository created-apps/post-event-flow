/**
 * Local smoke test — no external accounts required.
 *
 * Simulates a form submission, enrolls the lead, then forces every scheduled
 * task to be due and drains them. With placeholder credentials every send is a
 * logged DRY-RUN, so you can verify the wiring and message copy offline.
 *
 *   node scripts/test-send.js
 */
import { forceTasksDue, getTasksForLead } from '../src/db.js';
import { ingestResponse } from '../src/leads/ingest.js';
import { drainDueTasks } from '../src/scheduler.js';
import { extractEventName } from '../src/gemini.js';

console.log('\n=== 1. Slack message → event name extraction ===');
for (const msg of [
  'Need a google form for DAIS event',
  'hey can we get a form for the IIT Bombay Techfest next week?',
  'lunch anyone?',
]) {
  const r = await extractEventName(msg);
  console.log(`"${msg}"\n   ->`, r);
}

console.log('\n=== 2. Ingest a fake form response ===');
const { created, lead } = await ingestResponse({
  external_id: 'test-' + Date.now(),
  event_name: 'DAIS',
  answers: {
    'Student Name': 'Aarav Sharma',
    'Student Email': 'aarav@example.com',
    'Student Phone Number': '+919000000001',
    School: 'DAIS',
    'Grade / Graduation Year': 'Grade 10',
    'Parent Name': 'Priya Sharma',
    'Parent Email': 'priya@example.com',
    'Parent Phone Number': '+919000000002',
    'Student interests / notes': 'Robotics, sustainability',
  },
});
console.log('created:', created, 'leadId:', lead.id);

console.log('\n=== 3. Force all tasks due & drain (Day 0/2/5) ===');
await forceTasksDue(lead.id);
await drainDueTasks();

console.log('\n=== 4. Task ledger for this lead ===');
const rows = (await getTasksForLead(lead.id)).map(
  ({ type, channel, sent_at, cancelled, error }) => ({ type, channel, sent_at, cancelled, error })
);
console.table(rows);

console.log('\nDone. (All sends above are DRY-RUN until real credentials are set.)\n');
process.exit(0);
