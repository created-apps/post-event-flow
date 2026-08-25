# Setup Guide

Fill in `.env` (copied from `.env.example`) as you complete each section. The app boots with placeholders and runs everything as `[DRY-RUN]`; each integration goes live the moment its real values are present. `GET /health` shows the readiness flags.

---

## 0. Deploy the backend

Any Node host works (Render, Railway, Fly, a VM). It needs a public HTTPS URL because Slack, Google Apps Script and Twilio all call into it.

- Node ≥ 20, `npm install`, `npm start`.
- Set `PUBLIC_BASE_URL` to the public URL.
- Generate a long random `INGEST_TOKEN` (Apps Script will send it).

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
2. Set `TWILIO_WHATSAPP_FROM` (sandbox `whatsapp:+14155238886`, or your approved sender).
3. **Business-initiated messages require approved Content templates.** Submit these bodies for approval and paste the resulting SIDs:

   **WA1 → `TWILIO_CONTENT_SID_WA1`**
   ```
   Hi {{1}}, it was lovely meeting you at {{2}}!
   At CreatED, we work with students in Grades 8–12 to turn their interests into ambitious projects, research papers and competition-ready work.
   If you'd like to explore what could make sense specifically for {{3}}, you can book a consultation with our team here:
   Book a Consultation: {{4}}
   – Team CreatED
   ```
   **WA2 → `TWILIO_CONTENT_SID_WA2`**
   ```
   Hi {{1}}, just following up after {{2}}.
   At CreatED, students don't start with a predetermined project. We look at their interests, academic direction and previous experiences, and then help them identify something genuinely worth building or researching.
   If you'd like us to explore potential directions for {{3}}, you can book an initial consultation here:
   Book a Consultation: {{4}}
   – Team CreatED
   ```
   Variable order is `{{1}}=Parent name, {{2}}=Event, {{3}}=Student, {{4}}=Consultation URL` (see `src/templates/whatsapp.js`).
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
