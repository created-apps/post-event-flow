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

/**
 * Log to BOTH sinks: Logger.log shows in the editor's Execution log pane,
 * console.log shows in Apps Script → Executions (expand the row) and in Cloud
 * logs — which is the only place trigger runs leave a trace.
 */
function log_(msg) {
  var args = Array.prototype.slice.call(arguments);
  var line = args.length > 1 ? Utilities.formatString.apply(null, args) : String(msg);
  Logger.log(line);
  console.log(line);
  return line;
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
  log_('Trigger installed and Event Name column ensured.');
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
  postLead_({
    external_id: 'row-' + row + '-' + (e && e.values ? e.values[0] : new Date().toISOString()),
    event_name: eventName,
    answers: answers,
  });
}

/**
 * POST one lead to the backend. Throws on a non-2xx reply or a transport error
 * so the run shows up red in Apps Script → Executions instead of failing quietly.
 */
function postLead_(payload) {
  var backend = _cfg('BACKEND_URL', '');
  if (!backend) {
    log_('BACKEND_URL not set — skipping POST.');
    return;
  }

  var url = backend.replace(/\/$/, '') + '/leads';
  log_('POST %s', url);

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-ingest-token': _cfg('INGEST_TOKEN', '') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: true,
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  log_('Backend responded %s: %s', code, body);
  if (code < 200 || code >= 300) {
    throw new Error('Backend returned ' + code + ': ' + body);
  }
  return body;
}

/**
 * Run this by hand from the editor to test the backend hop on its own, with no
 * form submission involved. A lead should appear in Supabase and the Day-0
 * WhatsApp + email should fire.
 */
function testPost() {
  var stamp = new Date().toISOString();
  postLead_({
    external_id: 'manual-test-' + stamp,
    event_name: currentEventName_() || 'Manual Test',
    answers: {
      'Student Name': 'Test Student',
      'Student Email': 'test@example.com',
      'Parent Name': 'Test Parent',
      'Parent Email': 'test@example.com',
      'Parent Phone Number': '+910000000000',
    },
  });
}

/**
 * Run this by hand to see why submissions are not reaching the backend. It
 * checks the four things that actually go wrong, in the order they go wrong.
 *
 * Output lands in three places: the editor's Execution log pane, the expanded
 * row in Apps Script → Executions, and — if anything failed — the error message
 * on the Executions row itself, so a red run tells you what broke without
 * opening anything.
 */
function diagnose() {
  var fails = [];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    log_('FAIL: no active spreadsheet — this script is not bound to the responses SHEET.');
    log_('Fix: open the responses spreadsheet → Extensions → Apps Script, and put this code there.');
    throw new Error('Not bound to a spreadsheet — paste this code into the responses sheet\'s Apps Script project.');
  }
  log_('Spreadsheet: %s', ss.getName());

  var sheet = ss.getSheets()[0];
  log_('First sheet: "%s", rows: %s', sheet.getName(), sheet.getLastRow());
  var formUrl = sheet.getFormUrl();
  log_('Linked form: %s', formUrl || 'NONE');
  if (!formUrl) fails.push('first sheet has no linked form');

  var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'onFormSubmit';
  });
  if (!triggers.length) {
    log_('FAIL: no onFormSubmit trigger installed — the script never runs on submit.');
    log_('Fix: run installTrigger() once and authorise it.');
    fails.push('no onFormSubmit trigger — run installTrigger()');
  } else {
    log_('OK: %s onFormSubmit trigger(s) installed.', triggers.length);
  }

  var backend = _cfg('BACKEND_URL', '');
  log_('BACKEND_URL: %s', backend || '(not set)');
  if (!backend) fails.push('BACKEND_URL script property is not set');
  if (backend && backend.indexOf('localhost') !== -1) {
    fails.push('BACKEND_URL points at localhost — Apps Script runs on Google servers and cannot reach it');
  }
  log_('INGEST_TOKEN set: %s', _cfg('INGEST_TOKEN', '') ? 'yes' : 'NO');
  log_('Event name from form title: "%s"', currentEventName_());

  if (backend) {
    try {
      var res = UrlFetchApp.fetch(backend.replace(/\/$/, '') + '/health', {
        muteHttpExceptions: true,
      });
      var code = res.getResponseCode();
      log_('GET /health -> %s: %s', code, res.getContentText());
      if (code < 200 || code >= 300) fails.push('backend /health returned ' + code);
    } catch (err) {
      log_('FAIL: backend unreachable from Apps Script: %s', err);
      fails.push('backend unreachable: ' + err);
    }
  }

  if (fails.length) {
    var summary = fails.length + ' problem(s): ' + fails.join(' | ');
    log_('DIAGNOSE FAILED — %s', summary);
    throw new Error(summary);
  }
  log_('DIAGNOSE: all checks passed. If submissions still miss the DB, submit the form and check Executions for the onFormSubmit run.');
}
