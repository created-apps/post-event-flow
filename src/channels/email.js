import sgMail from '@sendgrid/mail';
import config from '../config.js';
import logger from '../logger.js';

let ready = false;
if (config.ready.sendgrid) {
  sgMail.setApiKey(config.sendgrid.apiKey);
  ready = true;
} else {
  logger.warn('SendGrid not configured — emails will be logged, not sent.');
}

/**
 * Send an email built by templates/emails.js.
 * @param {string} to
 * @param {{subject:string,text:string,html:string}} content
 */
export async function sendEmail(to, content) {
  if (!to || !/\S+@\S+\.\S+/.test(to)) {
    throw new Error(`Missing/invalid recipient email: ${to}`);
  }

  if (!ready) {
    logger.info('[DRY-RUN] Email', { to, subject: content.subject });
    return { dryRun: true };
  }

  const msg = {
    to,
    from: { email: config.sendgrid.from, name: config.sendgrid.fromName },
    subject: content.subject,
    text: content.text,
    html: content.html,
  };
  if (config.sendgrid.bcc && !config.sendgrid.bcc.includes('<')) {
    msg.bcc = config.sendgrid.bcc;
  }

  const [res] = await sgMail.send(msg);
  logger.info('Email sent', {
    to,
    subject: content.subject,
    status: res.statusCode,
    messageId: res.headers['x-message-id'],
  });
  return { statusCode: res.statusCode };
}

export default { sendEmail };
