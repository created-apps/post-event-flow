import express from 'express';
import config from './config.js';
import logger from './logger.js';
import { handleSlackRequest } from './slack/handler.js';
import { startSlackPolling } from './slack/poll.js';
import { ingestResponse } from './leads/ingest.js';
import { setLeadFlag, cancelPendingTasks, getLead } from './db.js';
import { startScheduler, drainDueTasks } from './scheduler.js';

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health / readiness ────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, ready: config.ready });
});

// ── Slack events ────────────────────────────────────────────────────────────
// Requires a public HTTPS URL. For local work use polling instead
// (SLACK_POLL_ENABLED=true, or `npm run slack:poll`) — same handler, no tunnel.
app.post('/slack/events', (req, res) => {
  const { immediate, async: asyncWork } = handleSlackRequest(req.body || {});
  // Ack Slack immediately (must be < 3s).
  res.json(immediate);
  // Do the real work after acking.
  if (asyncWork) {
    Promise.resolve()
      .then(asyncWork)
      .catch((err) => logger.error('Slack async handler error', { error: err.message }));
  }
});

// ── Lead ingest (called by Apps Script onFormSubmit) ────────────────────────
app.post('/leads', async (req, res) => {
  const token = req.headers['x-ingest-token'];
  if (config.ready.ingest && token !== config.ingestToken) {
    return res.status(401).json({ ok: false, error: 'invalid ingest token' });
  }
  try {
    const { created, lead } = await ingestResponse(req.body || {});
    res.json({ ok: true, created, leadId: lead.id });
    // Fire Day-0 messages right away instead of waiting for the next cron tick.
    if (created) drainDueTasks();
  } catch (err) {
    logger.error('Ingest failed', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Stop conditions ─────────────────────────────────────────────────────────
// POST /leads/:id/booked | /optout | /close
const flagRoute = (flag) => async (req, res) => {
  const id = Number(req.params.id);
  try {
    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });
    await setLeadFlag(id, flag);
    const cancelled = await cancelPendingTasks(id);
    logger.info('Lead stop condition applied', { id, flag, cancelledTasks: cancelled });
    res.json({ ok: true, id, flag, cancelledTasks: cancelled });
  } catch (err) {
    logger.error('Stop condition failed', { id, flag, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
};
app.post('/leads/:id/booked', flagRoute('consultation_booked'));
app.post('/leads/:id/optout', flagRoute('opted_out'));
app.post('/leads/:id/close', flagRoute('closed'));

// ── Twilio inbound (opt-out keywords: STOP/UNSUBSCRIBE) ─────────────────────
app.post('/twilio/inbound', (req, res) => {
  const from = req.body.From || '';
  const bodyText = String(req.body.Body || '').trim().toUpperCase();
  logger.info('Twilio inbound', { from, body: bodyText });
  // Twilio auto-handles STOP for compliance; we also mark matching leads out.
  if (/^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)\b/.test(bodyText)) {
    // Best-effort: match by parent_phone digits.
    // (Left simple by design — no CRM. Extend with a phone->lead lookup.)
    logger.info('Opt-out keyword received', { from });
  }
  res.type('text/xml').send('<Response></Response>');
});

// ── Boot ────────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  logger.info(`Post-event-flow backend listening on :${config.port}`);
  logger.info('Integration readiness', config.ready);
  startScheduler();
  startSlackPolling();
});

export default app;
