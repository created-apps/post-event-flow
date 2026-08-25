import config from '../config.js';
import logger from '../logger.js';
import { claimSlackEvent, setConfig } from '../db.js';
import { extractEventName } from '../gemini.js';
import { setFormTitleForEvent } from '../google/forms.js';

/** Post a message to Slack (reply in-thread by passing thread_ts). */
async function postSlackMessage({ channel, text, thread_ts }) {
  if (!config.ready.slackReply) {
    logger.info('[DRY-RUN] Slack reply', { channel, thread_ts, text });
    return { dryRun: true };
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${config.slack.botToken}`,
    },
    body: JSON.stringify({ channel, text, thread_ts, unfurl_links: false }),
  });
  const json = await res.json();
  if (!json.ok) {
    logger.error('Slack postMessage failed', { error: json.error });
  }
  return json;
}

/**
 * Core handler for a Slack "message" event. Runs asynchronously after we've
 * already 200'd Slack (see server.js), so it can take its time.
 */
export async function handleSlackMessage(event) {
  // Ignore bot messages, edits, joins, our own replies, threaded noise, etc.
  if (
    !event ||
    event.type !== 'message' ||
    event.subtype || // edits, joins, bot_message, etc.
    event.bot_id
  ) {
    return;
  }

  // Restrict to the configured request channel (if set).
  if (
    config.slack.requestChannel &&
    !config.slack.requestChannel.includes('<') &&
    event.channel !== config.slack.requestChannel
  ) {
    logger.debug('Ignoring message outside request channel', {
      channel: event.channel,
    });
    return;
  }

  const text = event.text || '';
  const { isRequest, eventName, source } = await extractEventName(text);

  if (!isRequest) {
    logger.debug('Message not a form request', { text });
    return;
  }

  if (!eventName) {
    await postSlackMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: `I think you're asking for a Google Form, but I couldn't figure out the event name. Try: *Need a google form for DAIS event*`,
    });
    return;
  }

  logger.info('Form request detected', { eventName, source });

  try {
    const { title, responderUri } = await setFormTitleForEvent(eventName);
    // Remember the current event so form submissions can be stamped if needed.
    await setConfig('current_event_name', eventName);
    await setConfig('current_form_title', title);

    await postSlackMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text:
        `:white_check_mark: Form ready for *${eventName}*.\n` +
        `*${title}*\n${responderUri}\n\n` +
        `_Every new response will be tagged with the event name automatically._`,
    });
  } catch (err) {
    logger.error('Failed to rename form', { error: err.message });
    await postSlackMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: `:warning: I couldn't rename the form for *${eventName}*: ${err.message}`,
    });
  }
}

/**
 * Entry point from the /slack/events route. Handles url_verification and
 * event_callback envelopes. Returns the value to send back to Slack synchronously.
 */
export function handleSlackRequest(body) {
  // 1) URL verification handshake.
  if (body.type === 'url_verification') {
    return { immediate: { challenge: body.challenge } };
  }

  // 2) Event callback — process asynchronously; we must ack within 3s.
  //    Dedupe on event_id (Slack retries on non-200/timeout) happens in the
  //    async worker since it now touches the (async) database.
  if (body.type === 'event_callback') {
    return {
      immediate: { ok: true },
      async: async () => {
        const isNew = await claimSlackEvent(body.event_id);
        if (!isNew) {
          logger.debug('Duplicate Slack event ignored', { event_id: body.event_id });
          return;
        }
        await handleSlackMessage(body.event);
      },
    };
  }

  return { immediate: { ok: true } };
}
