-- Post-Event Lead Flow — Supabase schema.
-- Run this once in the Supabase SQL Editor (or via the CLI) for your project.
--
-- The backend connects with the SERVICE ROLE key and bypasses RLS, so no
-- policies are strictly required. RLS is enabled + locked down anyway so that
-- the anon/public key can never read lead PII.

create table if not exists public.leads (
  id                  bigint generated always as identity primary key,
  external_id         text unique,
  event_name          text,
  event_city          text,
  event_date          text,
  student_name        text,
  student_email       text,
  student_phone       text,
  school              text,
  grade               text,
  parent_name         text,
  parent_email        text,
  parent_phone        text,
  interests           text,
  raw                 jsonb,
  status              text default 'new',
  consultation_booked boolean default false,
  opted_out           boolean default false,
  closed              boolean default false,
  created_at          timestamptz default now()
);

create table if not exists public.tasks (
  id         bigint generated always as identity primary key,
  lead_id    bigint not null references public.leads(id) on delete cascade,
  type       text not null,          -- wa1|email1|wa2|email2|email3
  channel    text not null,          -- whatsapp|email
  due_at     timestamptz not null,
  sent_at    timestamptz,
  cancelled  boolean default false,
  error      text,
  attempts   int default 0,
  created_at timestamptz default now()
);

create index if not exists idx_tasks_due
  on public.tasks (sent_at, cancelled, due_at);
create index if not exists idx_tasks_lead
  on public.tasks (lead_id);

create table if not exists public.app_config (
  key   text primary key,
  value text
);

-- Dedupe table for Slack event retries.
create table if not exists public.slack_events (
  event_id   text primary key,
  created_at timestamptz default now()
);

-- Lock everything down: only the service role (used by the backend) may access.
alter table public.leads        enable row level security;
alter table public.tasks        enable row level security;
alter table public.app_config   enable row level security;
alter table public.slack_events enable row level security;
