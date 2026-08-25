/**
 * Local Slack listener — no public URL, no tunnel, no Event Subscriptions.
 *
 * Polls the configured channel with conversations.history and runs each new
 * message through the same handler the /slack/events webhook uses, so what you
 * see locally is what production does.
 *
 * Needs SLACK_BOT_TOKEN (scopes: chat:write + channels:history or
 * groups:history) and a channel ID in SLACK_POLL_CHANNEL (falls back to
 * SLACK_FORM_REQUEST_CHANNEL). The bot must be invited to that channel.
 *
 *   npm run slack:poll            # poll forever
 *   npm run slack:poll -- --once  # single pass, then exit
 *
 * Post "Need a google form for DAIS event" in the channel and watch the reply
 * (a real reply with a bot token, a [DRY-RUN] log line without one).
 */
import logger from '../src/logger.js';
import { pollSlackOnce, startSlackPolling } from '../src/slack/poll.js';
import config from '../src/config.js';

const once = process.argv.includes('--once');

if (!config.slack.poll.channel) {
  logger.error(
    'No channel to poll — set SLACK_POLL_CHANNEL (or SLACK_FORM_REQUEST_CHANNEL) ' +
      'to a channel ID like C0123456789.'
  );
  process.exit(1);
}

if (once) {
  const handled = await pollSlackOnce();
  logger.info('Single poll complete', { handled });
  process.exit(0);
}

// force: this script IS the opt-in, so SLACK_POLL_ENABLED need not be set.
const task = startSlackPolling({ force: true });
if (!task) process.exit(1);

logger.info('Listening — post a form request in the channel. Ctrl-C to stop.');
process.on('SIGINT', () => {
  task.stop();
  logger.info('Slack polling stopped.');
  process.exit(0);
});
