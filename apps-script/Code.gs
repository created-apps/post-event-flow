/**
 * Post-Event Lead Flow — Google Apps Script glue.
 *
 * Bind this to the Google SHEET that receives the form's responses
 * (Extensions → Apps Script from the responses spreadsheet).
 *
 * What it does on every form submission:
 *   1. Reads the event name from the linked form's current title
 *      (the backend renames that title from Slack).
 *   2. Writes the event name into an "Event Name" column on the new row,
 *      so every row in the sheet carries its event.
 *   3. POSTs the full response (+ event name) to the backend /leads endpoint,
 *      which fires the Twilio WhatsApp + SendGrid email sequence.
 *
 * ── One-time setup ─────────────────────────────────────────────────────────
 *  1. Project Settings → Script properties, add:
 *       BACKEND_URL     = https://<your-backend-host>
 *       INGEST_TOKEN    = <same value as backend .env INGEST_TOKEN>
 *       TITLE_PREFIX    = CreatED —        (must match backend FORM_TITLE_PREFIX)
 *       TITLE_SUFFIX    =  Lead Intake     (must match backend FORM_TITLE_SUFFIX)
 *  2. Run `installTrigger` once (authorise when prompted).
 */

var EVENT_COLUMN_HEADER = 'Event Name';

function _props() {
  return PropertiesService.getScriptProperties();
}

function _cfg(key, dflt) {
  var v = _props().getProperty(key);
  return v === null || v === undefined || v === '' ? dflt : v;
}

/** Create the installable onFormSubmit trigger. Run once. */
function installTrigger() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Remove any existing triggers for this function to avoid duplicates.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
  ensureEventColumn_();
  Logger.log('Trigger installed and Event Name column ensured.');
}

/** Ensure the responses sheet has an "Event Name" column; returns its index. */
function ensureEventColumn_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = headers.indexOf(EVENT_COLUMN_HEADER);
  if (idx === -1) {
    sheet.getRange(1, lastCol + 1).setValue(EVENT_COLUMN_HEADER);
    return lastCol + 1; // 1-based column index
  }
  return idx + 1;
}

/** Derive the raw event name from the linked form's title. */
function currentEventName_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var formUrl = sheet.getFormUrl();
  if (!formUrl) return '';
  var title = FormApp.openByUrl(formUrl).getTitle() || '';
  var prefix = _cfg('TITLE_PREFIX', '');
  var suffix = _cfg('TITLE_SUFFIX', '');
  var name = title;
  if (prefix && name.indexOf(prefix) === 0) name = name.slice(prefix.length);
  if (suffix && name.lastIndexOf(suffix) === name.length - suffix.length) {
    name = name.slice(0, name.length - suffix.length);
  }
  name = name.trim();
  return name || title.trim();
}

/**
 * Installable onFormSubmit handler.
 * `e.namedValues` = { "Question": ["answer"], ... }
 * `e.range`       = the newly written row range.
 */
function onFormSubmit(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var eventName = currentEventName_();

  // 1) Stamp the Event Name column for this row.
  var col = ensureEventColumn_();
  var row = e && e.range ? e.range.getRow() : sheet.getLastRow();
  sheet.getRange(row, col).setValue(eventName);

  // 2) Flatten namedValues -> { label: value }.
  var answers = {};
  var named = (e && e.namedValues) || {};
  Object.keys(named).forEach(function (k) {
    var v = named[k];
    answers[k] = Array.isArray(v) ? v.join(', ') : v;
  });
  answers[EVENT_COLUMN_HEADER] = eventName;

  // 3) POST to backend.
  var backend = _cfg('BACKEND_URL', '');
  if (!backend) {
    Logger.log('BACKEND_URL not set — skipping POST. Row stamped with "%s".', eventName);
    return;
  }

  var payload = {
    external_id: 'row-' + row + '-' + (e && e.values ? e.values[0] : new Date().toISOString()),
    event_name: eventName,
    answers: answers,
  };

  try {
    var res = UrlFetchApp.fetch(backend.replace(/\/$/, '') + '/leads', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-ingest-token': _cfg('INGEST_TOKEN', '') },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    Logger.log('Backend responded %s: %s', res.getResponseCode(), res.getContentText());
  } catch (err) {
    Logger.log('POST to backend failed: %s', err);
  }
}
