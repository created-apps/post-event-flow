# Setup Guide

Fill in `.env` (copied from `.env.example`) as you complete each section. The app boots with placeholders and runs everything as `[DRY-RUN]`; each integration goes live the moment its real values are present. `GET /health` shows the readiness flags.

---

## 0. Deploy the backend

Any Node host works (Render, Railway, Fly, a VM). It needs a public HTTPS URL because Slack, Google Apps Script and Twilio all call into it — Apps Script runs on Google's servers, so `http://localhost:3000` is not reachable from it.

- **Node ≥ 22**, `npm install`, `npm start`. Not optional: `@supabase/supabase-js` uses the native `WebSocket` global and throws at import time on Node 20 (`native WebSocket not found`). Pinned in `.nvmrc` and `package.json` → `engines`.
- Set `PUBLIC_BASE_URL` to the public URL.
- Generate a long random `INGEST_TOKEN` (Apps Script will send it).

**Railway:** [`railway.toml`](../railway.toml) is checked in — nixpacks build, `npm start`, health check on `/health`, restart on failure, and `numReplicas = 1` (the task scheduler and Slack poller are in-process cron jobs with no cross-instance lock, so a second replica would double-send). Set every variable from `.env.example` as a service variable in the dashboard; `.env` is gitignored and never deployed. Railway injects `PORT` itself. If a build still lands on an older Node, add `NIXPACKS_NODE_VERSION=22`.

---

## 0.5 Supabase (database)

1. Create a project at <https://supabase.com>.
2. SQL Editor → paste and run [`supabase/schema.sql`](../supabase/schema.sql). This creates `leads`, `tasks`, `app_config`, `slack_events` (RLS enabled; the backend uses the service role).
3. Settings → API → set:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = the **service_role** key (server-side only — never ship to a client)
4. Leave these as placeholders to run offline with the in-memory store.

---

## 1. Google Form + service account (rename the form)

1. You already have **one** standard intake form. Copy its **form ID** from the edit URL `…/forms/d/<FORM_ID>/edit` → `GOOGLE_FORM_ID`.
2. Create a **service account** in Google Cloud → enable the **Google Forms API** → create a JSON key. Then provide it one of two ways:
   - **Hosted (recommended):** base64-encode the whole file and set `GOOGLE_CREDENTIALS_BASE64`:
     ```bash
     base64 -i google-service-account.json | tr -d '\n'
     ```
     Paste the output as the env var value (one line). No file needs to live on the server.
   - **Local dev:** save the file to `./secrets/google-service-account.json` and set `GOOGLE_APPLICATION_CREDENTIALS` to its path (leave the base64 var blank).

   If both are set, the base64 var wins.
3. **Share the form** (Editor) with the service account's `client_email` (from the JSON). Without this the API returns 403.
4. Set `FORM_TITLE_PREFIX` / `FORM_TITLE_SUFFIX` — the final title becomes e.g. `CreatED — DAIS Lead Intake`. **These two must match the Apps Script `TITLE_PREFIX` / `TITLE_SUFFIX` script properties** so the event name round-trips correctly.

The form's questions should capture the standard intake fields (student/parent name, email, phone, school, grade, interests). The **Event Name** is *not* a question — it is stamped automatically by Apps Script from the form title.

---

## 2. Apps Script (stamp event name + post rows)

1. Open the **responses spreadsheet** → Extensions → Apps Script.
2. Paste `apps-script/Code.gs`; set the manifest from `apps-script/appsscript.json`.
3. Project Settings → **Script properties**:
   - `BACKEND_URL` = your `PUBLIC_BASE_URL`
   - `INGEST_TOKEN` = same as backend `.env`
   - `TITLE_PREFIX` = same as backend `FORM_TITLE_PREFIX`
   - `TITLE_SUFFIX` = same as backend `FORM_TITLE_SUFFIX`
4. Run `installTrigger` once and authorise. This creates the onFormSubmit trigger and adds the **Event Name** column.

Now every submission stamps the event name into the sheet and POSTs to `/leads`.

### Rows land in the sheet but not in the database

Rows in the sheet prove nothing about the script — **Google Forms writes them itself**, no Apps Script involved. Work through it in this order:

1. **Is the Event Name column filled on the new row?** If it is blank, the script never ran: the trigger is missing (run `installTrigger`), or its authorisation was revoked, or this code is not bound to the responses spreadsheet.
2. **Run `diagnose()`** from the editor. It reports the bound spreadsheet, the linked form, whether an `onFormSubmit` trigger exists, the script properties, and a live `GET /health` against `BACKEND_URL`. It throws on any problem, so a red row in Executions shows the reason inline; the full report is in the editor's **Execution log** pane and inside the expanded Executions row. The Executions *list* only shows "Execution started / completed" — expand the row to see log output.
3. **Run `testPost()`** to exercise the backend hop alone, with no form submission. A lead should appear in Supabase.
4. **Apps Script → Executions** lists every trigger run. No rows there = the trigger is not firing. Rows marked *Failed* carry the backend's status code and body.

Common causes: `BACKEND_URL` pointing at `localhost` (Apps Script runs on Google's servers and cannot reach your laptop — it needs the public host); the backend being down, so the POST gets a 502; `installTrigger` never run; or the script living in a standalone project instead of one bound to the responses sheet.

---

## 3. Gemini (event-name extraction)

1. Get an API key at <https://aistudio.google.com/apikey> → `GEMINI_API_KEY`.
2. `GEMINI_MODEL` defaults to `gemini-2.5-flash`.

If Gemini is unset or errors, the regex fallback handles standard phrasing like *"Need a google form for DAIS event"*.

---

## 4. Slack app (trigger + reply)

1. Create a Slack app → **OAuth & Permissions** → Bot scopes: `chat:write`, and `channels:history` (public) or `groups:history` (private). Install → copy **Bot User OAuth Token** (`xoxb-…`) → `SLACK_BOT_TOKEN`.
2. Invite the bot to your request channel; put that channel's ID (the `C…` value, not `#name`) in `SLACK_FORM_REQUEST_CHANNEL` (leave blank to allow any channel).
3. Choose how messages reach the backend:

   **A. Polling — local testing, no public URL.** Nothing to configure in the Slack app: the backend pulls new messages with `conversations.history`.

   ```bash
   npm run slack:poll            # poll forever (Ctrl-C to stop)
   npm run slack:poll -- --once  # single pass, then exit
   ```

   Or set `SLACK_POLL_ENABLED=true` and the poller runs inside `npm run dev` / `npm start` alongside everything else. The loop is a `node-cron` job, like the task scheduler. Tuning: `SLACK_POLL_CHANNEL` (defaults to `SLACK_FORM_REQUEST_CHANNEL`), `SLACK_POLL_INTERVAL_SECONDS` (default 5 — becomes a seconds-field cron expression such as `*/5 * * * * *`; pick a divisor of 60 for an even cadence, 60 and above round to whole minutes), `SLACK_POLL_BACKFILL_SECONDS` (default 0 — on a cold start only messages posted from that moment on are read, so the bot never answers a backlog). The cursor is stored in `app_config` as `slack_poll_cursor`, so a restart resumes instead of replaying; delete that row to re-read from now.

   **B. Event Subscriptions — production.** Enable → Request URL: `https://<PUBLIC_BASE_URL>/slack/events` (Slack sends a `url_verification` challenge; the backend answers it automatically). Subscribe to bot event `message.channels` (and/or `message.groups`).

   > `/slack/events` does **no** signature check — there is no signing secret in this project. Keep that route behind something that restricts callers, or run polling only (mode A works in production too).

Either way: post *"Need a google form for DAIS event"* → the form is renamed and the bot replies in-thread with the link. Both modes run the same handler and dedupe against the same table, so behaviour is identical.

---

## 5. Twilio WhatsApp

1. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` from the Twilio console.
2. Set the sender — **either** works, and the Messaging Service wins when both are present:
   - `TWILIO_MESSAGING_SERVICE_SID` (Messaging → Services) with your WhatsApp sender in its pool. No `From` is sent; Twilio picks the sender from the pool, so there is no `whatsapp:` address to keep in sync.
   - `TWILIO_WHATSAPP_FROM` — a specific sender, E.164 with the `whatsapp:` prefix (sandbox `whatsapp:+14155238886`, or your approved sender).

   Two errors you will hit if this is wrong:
   - **21910 `Invalid From and To pair`** — one side has the `whatsapp:` prefix and the other doesn't. The code normalises both sides now, so this should not recur.
   - **63007 `Twilio could not find a Channel with the specified From address`** — the number is not a registered WhatsApp sender on this account, or its status is not `ONLINE`. Register the sender, use a Messaging Service that owns it, or fall back to the sandbox number (and join the sandbox from the receiving phone).
3. **Business-initiated messages require approved Content templates.** Submit these bodies for approval and paste the resulting SIDs:

   **WA1 → `TWILIO_CONTENT_SID_WA1`**
   ```
   Hi {{Parent_Name}}, it was lovely meeting you at {{Event_Name}}!
   At CreatED, we work with students in Grades 8–12 to turn their interests into ambitious projects, research papers and competition-ready work.
   If you'd like to explore what could make sense specifically for {{Student_Name}}, you can book a consultation with our team here:
   Book a Consultation: https://www.create-ed.in/schedule-a-consultation
   – Team CreatED
   ```
   **WA2 → `TWILIO_CONTENT_SID_WA2`**
   ```
   Hi {{Parent_Name}}, just following up after {{Event_Name}}.
   At CreatED, students don't start with a predetermined project. We look at their interests, academic direction and previous experiences, and then help them identify something genuinely worth building or researching.
   If you'd like us to explore potential directions for {{Student_Name}}, you can book an initial consultation here:
   Book a Consultation: https://www.create-ed.in/schedule-a-consultation
   – Team CreatED
   ```
   Variables are **named**: `Parent_Name`, `Event_Name`, `Student_Name` — declared in `VAR` at the top of `src/templates/whatsapp.js`. The keys sent in `ContentVariables` must match the template's variable names exactly (alphanumeric, no spaces, 16 chars max). Any template variable we don't send falls back to the **template's default placeholder text**, so a delivered message showing literal `{{Parent_Name}}` filler means the keys didn't match — not that the data was missing. The consultation link is hard-coded in the template rather than passed as a variable; if you make it a variable instead, add it to `VAR` and to both builders.
4. Optional: set the Twilio inbound webhook to `https://<PUBLIC_BASE_URL>/twilio/inbound` for opt-out handling.

> In the WhatsApp **sandbox** free-form text is allowed, so the flow works for testing even before templates are approved. In production without a valid Content SID the send falls back to free-form and will only deliver inside a 24h session window.

---

## 6. SendGrid

1. `SENDGRID_API_KEY` (Mail Send permission).
2. Verify a sender/domain and set `EMAIL_FROM` / `EMAIL_FROM_NAME`.
3. Optional `EMAIL_BCC` for an internal copy.

Emails are rendered inline (no dynamic template required) from `src/templates/emails.js`.

---

## 7. Timing (optional, for testing)

`DELAY_HOURS_DAY2` (default 48) and `DELAY_HOURS_DAY5` (default 120). Lower them to compress the sequence when testing.

---

## Verify

```bash
node scripts/test-send.js        # offline dry-run of extraction + full sequence + stop
curl https://<PUBLIC_BASE_URL>/health
```
