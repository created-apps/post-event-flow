import { google } from 'googleapis';
import config from '../config.js';
import logger from '../logger.js';

/**
 * Google Forms API wrapper.
 *
 * We rename the ONE standard form and read its public responder link. Auth uses
 * a service account (key file at GOOGLE_APPLICATION_CREDENTIALS). The form must
 * be shared as Editor with the service account's client_email, otherwise the
 * API returns 403.
 *
 * Scopes: forms.body (edit title) + forms.body.readonly (read responderUri).
 */
const SCOPES = ['https://www.googleapis.com/auth/forms.body'];

/** Build GoogleAuth from base64 JSON (preferred) or a key-file path. */
function buildAuth() {
  if (config.google.credentialsBase64 && !config.google.credentialsBase64.includes('<')) {
    let creds;
    try {
      creds = JSON.parse(
        Buffer.from(config.google.credentialsBase64, 'base64').toString('utf8')
      );
    } catch (err) {
      throw new Error(
        `GOOGLE_CREDENTIALS_BASE64 is not valid base64-encoded JSON: ${err.message}`
      );
    }
    return new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  }
  return new google.auth.GoogleAuth({
    keyFile: config.google.credentialsPath,
    scopes: SCOPES,
  });
}

let formsApi = null;
function getApi() {
  if (formsApi) return formsApi;
  if (!config.ready.googleForms) return null;
  formsApi = google.forms({ version: 'v1', auth: buildAuth() });
  return formsApi;
}

/** Build the full form title from the event name + configured prefix/suffix. */
export function buildTitle(eventName) {
  const parts = [
    config.google.titlePrefix?.trim(),
    eventName?.trim(),
    config.google.titleSuffix?.trim(),
  ].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Rename the standard form's title to the event. Returns { title, responderUri }.
 *
 * Only `info.title` (the heading respondents see) is updated: the Forms API
 * treats `documentTitle` — the Drive file name — as create-only and rejects it
 * in batchUpdate with "document_title ... is read-only in subsequent requests".
 * Renaming the Drive file would need the Drive API and a broader scope.
 */
export async function setFormTitleForEvent(eventName) {
  const title = buildTitle(eventName);
  const api = getApi();

  if (!api) {
    const responderUri = `https://docs.google.com/forms/d/${
      config.google.formId || '<form-id>'
    }/viewform`;
    logger.info('[DRY-RUN] Would rename form', { title, responderUri });
    return { title, responderUri, dryRun: true };
  }

  await api.forms.batchUpdate({
    formId: config.google.formId,
    requestBody: {
      requests: [
        {
          updateFormInfo: {
            info: { title },
            updateMask: 'title',
          },
        },
      ],
    },
  });

  const { data } = await api.forms.get({ formId: config.google.formId });
  logger.info('Form renamed', { title, responderUri: data.responderUri });
  return { title, responderUri: data.responderUri };
}

/** Read the current form title (used by Apps Script alt-path / diagnostics). */
export async function getFormInfo() {
  const api = getApi();
  if (!api) return { title: null, responderUri: null, dryRun: true };
  const { data } = await api.forms.get({ formId: config.google.formId });
  return { title: data.info?.title, responderUri: data.responderUri };
}
