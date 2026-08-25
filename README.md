# Post-Event Lead Flow

Automates the post-fair/event lead flow for CreatED:

1. **Slack → rename the form.** Someone posts *"Need a google form for DAIS event"* in a Slack channel (delivered by Event Subscriptions, or by polling for local testing). Gemini extracts the event name (with a regex fallback so it never breaks), the backend renames the **single** standard Google Form to that event, and replies in-thread with the form link.
2. **One responses sheet, event-tagged.** Apps Script stamps the **Event Name** onto every response row and posts the row to the backend.
3. **Backend runs the sequence.** On each submission it sends **Twilio WhatsApp 1 + SendGrid Email 1** immediately, schedules **WhatsApp 2 + Email 2 (Day 2)** and **Email 3 (Day 5)**, and stops the sequence on the doc's stop conditions (consultation booked / opted out / closed).

> CRM, per-event form copies, QR codes and the dashboard are intentionally **out of scope** for now.

## Architecture

```
Slack channel ──"need a form for X"──▶  POST /slack/events  (or polling)
                                          │  Gemini extracts "X" (regex fallback)
                                          ▼
                                   Google Forms API  ──rename title──▶  the ONE form
                                          │
                                          └─ reply in Slack thread with form link

Parent submits form ─▶ Google Sheet ─▶ Apps Script onFormSubmit
                                          │  stamps "Event Name" column
                                          ▼
                                     POST /leads  (x-ingest-token)
                                          │
                                          ▼
                        ┌──────────── backend ────────────┐
                        │ Day 0: WhatsApp 1 + Email 1      │  Twilio + SendGrid
                        │ Day 2: WhatsApp 2 + Email 2      │
                        │ Day 5: Email 3                   │
                        │ stop: booked / optout / closed   │
                        └──────────────────────────────────┘
```

## Layout

| Path | What |
|---|---|
| `src/server.js` | Express app: `/slack/events`, `/leads`, stop-condition routes, `/twilio/inbound`, `/health` |
| `src/slack/` | Event handling, `conversations.history` polling, in-thread reply |
| `src/gemini.js` | Event-name extraction (Gemini + regex fallback) |
| `src/google/forms.js` | Rename the form via Google Forms API, read responder link |
| `src/leads/ingest.js` | Map a form row → lead (field aliases), dedupe, enroll |
| `src/leads/sequence.js` | The Day 0/2/5 plan + per-task dispatch + stop checks |
| `src/channels/whatsapp.js` | Twilio WhatsApp (Content templates, dry-run fallback) |
| `src/channels/email.js` | SendGrid email (dry-run fallback) |
| `src/templates/` | Email 1–3 and WhatsApp 1–2 copy, transcribed from the docs |
| `src/scheduler.js` | Polls due tasks every minute |
| `src/db.js` | Data layer: **Supabase (Postgres)** when configured, else an in-memory fallback for offline dry-runs |
| `supabase/schema.sql` | Tables to create in your Supabase project (`leads`, `tasks`, `app_config`, `slack_events`) |
| `apps-script/Code.gs` | onFormSubmit: stamp event name + POST to backend |
| `scripts/slack-poll.js` | Local Slack listener — poll a channel without a public URL |

## Quick start (offline, no accounts needed)

```bash
npm install
cp .env.example .env      # placeholders are fine for a dry run
node scripts/test-send.js
```

Every send prints as a `[DRY-RUN]` line until real credentials are set — so you can review the exact copy and wiring first. See [docs/SETUP.md](docs/SETUP.md) to wire up Slack, Google, Gemini, Twilio and SendGrid.

## Run the backend

```bash
npm start        # or: npm run dev  (auto-reload)
```

`GET /health` returns which integrations are live vs. still on placeholders.

## Testing Slack locally (no public URL)

Event Subscriptions need Slack to reach a public HTTPS URL. To skip the tunnel, poll instead — the backend reads new channel messages with `conversations.history` and runs them through the same handler:

```bash
npm run slack:poll
```

Then post *"Need a google form for DAIS event"* in the channel. Needs `SLACK_BOT_TOKEN` (scopes `chat:write` + `channels:history`/`groups:history`), the bot invited to the channel, and a channel ID in `SLACK_POLL_CHANNEL` or `SLACK_FORM_REQUEST_CHANNEL`. Add `-- --once` for a single pass, or set `SLACK_POLL_ENABLED=true` to poll from inside `npm run dev`. See [docs/SETUP.md](docs/SETUP.md#4-slack-app-trigger--reply) for the tuning knobs.

## Database

Uses **Supabase**. Create the tables once from [`supabase/schema.sql`](supabase/schema.sql) (SQL Editor or CLI) and set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is server-side only. If those are left as placeholders the app falls back to an in-memory store so `scripts/test-send.js` runs offline.

## Stop conditions (no CRM)

Until a CRM is added, trigger stops manually or via webhook:

```bash
curl -X POST $BASE/leads/<id>/booked   # consultation booked → cancels remaining nudges
curl -X POST $BASE/leads/<id>/optout   # opted out
curl -X POST $BASE/leads/<id>/close    # closed/lost
```

Twilio inbound STOP keywords hit `/twilio/inbound` (Twilio also auto-handles STOP for compliance).
