import cron from 'node-cron';
import config from '../config.js';
import logger from '../logger.js';
import { claimSlackEvent, getConfig, setConfig } from '../db.js';
import { handleSlackMessage } from './handler.js';

/**
 * Slack polling mode — the local-development alternative to Event Subscriptions.
 *
 * Instead of Slack pushing events to a public HTTPS URL (which needs a tunnel
 * such as ngrok), we pull new channel messages with `conversations.history`
 * using the bot token and feed them through the exact same handler the webhook
 * uses. Nothing about the downstream behaviour changes.
 *
 * The loop runs on node-cron (like src/scheduler.js), on a seconds-field
 * expression derived from SLACK_POLL_INTERVAL_SECONDS.
 *
 * Cursor: the `ts` of the newest message we have already processed, persisted
 * via app_config so a restart does not replay the channel. On a cold start we
 * begin at "now" (minus SLACK_POLL_BACKFILL_SECONDS) so the bot never answers
 * a backlog of old messages.
 */

const CURSOR_KEY = 'slack_poll_cursor';
const MAX_PAGES = 5; // safety valve — a poll tick should never walk forever

async function slackApi(method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${config.slack.botToken}` },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || `${method} failed`);
  return json;
}

/** Human-readable remedy for the Slack errors people actually hit locally. */
function explain(error) {
  switch (error) {
    case 'not_in_channel':
      return 'the bot is not in that channel — invite it with /invite @your-bot';
    case 'channel_not_found':
      return 'SLACK_POLL_CHANNEL / SLACK_FORM_REQUEST_CHANNEL is not a channel ID this bot can see (use the C… ID, not the #name)';
    case 'missing_scope':
    case 'not_allowed_token_type':
      return 'the bot token is missing channels:history (public) or groups:history (private) — add the scope and reinstall the app';
    case 'invalid_auth':
    case 'account_inactive':
      return 'SLACK_BOT_TOKEN is invalid — copy a fresh Bot User OAuth Token (xoxb-…)';
    default:
      return null;
  }
}

async function readCursor() {
  const saved = await getConfig(CURSOR_KEY);
  if (saved) return saved;
  const start = (Date.now() - config.slack.poll.backfillSeconds * 1000) / 1000;
  const cursor = start.toFixed(6);
  await setConfig(CURSOR_KEY, cursor);
  logger.info('Slack polling cursor initialised', { oldest: cursor });
  return cursor;
}

/** Fetch every message newer than `oldest`, oldest-first. */
async function fetchNewMessages(channel, oldest) {
  const messages = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await slackApi('conversations.history', {
      channel,
      oldest,
      inclusive: false,
      limit: 100,
      cursor,
    });
    messages.push(...(json.messages || []));
    cursor = json.response_metadata?.next_cursor;
    if (!json.has_more || !cursor) break;
    if (page === MAX_PAGES - 1) {
      logger.warn('Slack polling stopped paging early', { pages: MAX_PAGES });
    }
  }
  // Slack returns newest-first; process in chronological order.
  return messages.reverse();
}

/**
 * Run a single poll. Returns the number of messages handed to the handler.
 * Safe to call directly (see `npm run slack:poll -- --once`).
 */
export async function pollSlackOnce() {
  const channel = config.slack.poll.channel;
  const oldest = await readCursor();
  const messages = await fetchNewMessages(channel, oldest);
  if (!messages.length) return 0;

  logger.info('Slack polling picked up messages', { count: messages.length });
  let handled = 0;
  for (const msg of messages) {
    // Advance the cursor first: a message that throws must not be replayed
    // forever on every subsequent tick.
    await setConfig(CURSOR_KEY, msg.ts);
    const isNew = await claimSlackEvent(`poll:${channel}:${msg.ts}`);
    if (!isNew) {
      logger.debug('Duplicate polled message ignored', { ts: msg.ts });
      continue;
    }
    await handleSlackMessage({ ...msg, type: 'message', channel });
    handled++;
  }
  return handled;
}

/**
 * node-cron expression for a poll every `seconds`. node-cron accepts an
 * optional leading seconds field, so sub-minute polling still works — which
 * matters here: a form request should be answered in seconds, not on the
 * minute boundary the task scheduler runs on.
 *
 * An interval that doesn't divide 60 evenly (7s, say) fires at :00 :07 … :56
 * and then restarts at the top of the minute; pick a divisor of 60 for an even
 * cadence. 60s and above are rounded to whole minutes.
 */
export function cronExpression(seconds) {
  if (seconds < 60) return `*/${seconds} * * * * *`;
  return `0 */${Math.min(59, Math.round(seconds / 60))} * * * *`;
}

let polling = false;

async function tick() {
  if (polling) return; // a slow Gemini/Forms call must not stack up ticks
  polling = true;
  try {
    await pollSlackOnce();
  } catch (err) {
    const hint = explain(err.message);
    logger.error('Slack polling error', {
      error: err.message,
      ...(hint ? { hint } : {}),
    });
  } finally {
    polling = false;
  }
}

/**
 * Start the poll loop (node-cron, same as the task scheduler). Returns the
 * scheduled task — call .stop() on it — or null when polling is off or
 * unconfigured. Pass { force: true } to ignore SLACK_POLL_ENABLED.
 */
export function startSlackPolling({ force = false } = {}) {
  if (!force && !config.slack.poll.enabled) return null;

  if (!config.ready.slackReply) {
    logger.warn('Slack polling not started: SLACK_BOT_TOKEN is not set.');
    return null;
  }
  if (!config.slack.poll.channel) {
    logger.warn(
      'Slack polling not started: set SLACK_POLL_CHANNEL (or SLACK_FORM_REQUEST_CHANNEL) ' +
        'to the channel ID to poll.'
    );
    return null;
  }

  const expression = cronExpression(config.slack.poll.intervalSeconds);
  if (!cron.validate(expression)) {
    logger.error('Slack polling not started: invalid schedule', {
      expression,
      intervalSeconds: config.slack.poll.intervalSeconds,
    });
    return null;
  }

  const task = cron.schedule(expression, tick);
  logger.info('Slack polling started', {
    channel: config.slack.poll.channel,
    cron: expression,
  });
  tick(); // don't make the first message wait a full interval
  return task;
}
