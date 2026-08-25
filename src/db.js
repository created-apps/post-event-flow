import { createClient } from '@supabase/supabase-js';
import config from './config.js';
import logger from './logger.js';

/**
 * Data access layer.
 *
 * Two interchangeable backends behind one async API:
 *   • Supabase (Postgres)  — used when SUPABASE_URL + SERVICE_ROLE_KEY are set.
 *   • In-memory            — automatic fallback so `node scripts/test-send.js`
 *                            and local dry-runs work with zero credentials.
 *
 * Every exported function is async (Supabase is over the network), so all
 * callers `await` them.
 *
 * Note on stop conditions: getDueTasks returns tasks that are simply due and
 * unsent; dispatchTask re-checks the lead's opted_out / closed / booked flags
 * at send time, so we don't need a join here.
 */

const nowIso = () => new Date().toISOString();

// ───────────────────────────── Supabase backend ─────────────────────────────
function supabaseBackend() {
  const sb = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });

  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    async getConfig(key) {
      const { data, error } = await sb
        .from('app_config')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.value ?? null;
    },
    async setConfig(key, value) {
      must(await sb.from('app_config').upsert({ key, value: String(value) }));
    },
    async claimSlackEvent(eventId) {
      if (!eventId) return true;
      const { error } = await sb.from('slack_events').insert({ event_id: eventId });
      if (error) {
        if (error.code === '23505') return false; // duplicate → already handled
        throw new Error(error.message);
      }
      return true;
    },
    async getLead(id) {
      const { data, error } = await sb
        .from('leads')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? undefined;
    },
    async getLeadByExternalId(extId) {
      if (!extId) return undefined;
      const { data, error } = await sb
        .from('leads')
        .select('*')
        .eq('external_id', extId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? undefined;
    },
    async insertLead(lead) {
      const row = { ...lead, raw: lead.raw ? JSON.parse(lead.raw) : null };
      const { data, error } = await sb.from('leads').insert(row).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async setLeadFlag(id, flag) {
      const patch = { [flag]: true, status: flag };
      const data = must(
        await sb.from('leads').update(patch).eq('id', id).select('id')
      );
      return data.length > 0;
    },
    async cancelPendingTasks(leadId) {
      const data = must(
        await sb
          .from('tasks')
          .update({ cancelled: true })
          .eq('lead_id', leadId)
          .is('sent_at', null)
          .eq('cancelled', false)
          .select('id')
      );
      return data.length;
    },
    async insertTask(leadId, type, channel, dueAtIso) {
      const data = must(
        await sb
          .from('tasks')
          .insert({ lead_id: leadId, type, channel, due_at: dueAtIso })
          .select('id')
          .single()
      );
      return data.id;
    },
    async getDueTasks(limit = 50) {
      const data = must(
        await sb
          .from('tasks')
          .select('*')
          .is('sent_at', null)
          .eq('cancelled', false)
          .lte('due_at', nowIso())
          .order('due_at', { ascending: true })
          .limit(limit)
      );
      return data;
    },
    async markTaskSent(id) {
      const task = await this.getTask(id);
      must(
        await sb
          .from('tasks')
          .update({ sent_at: nowIso(), attempts: (task?.attempts ?? 0) + 1, error: null })
          .eq('id', id)
      );
    },
    async markTaskError(id, err) {
      const task = await this.getTask(id);
      must(
        await sb
          .from('tasks')
          .update({ attempts: (task?.attempts ?? 0) + 1, error: String(err).slice(0, 500) })
          .eq('id', id)
      );
    },
    async getTask(id) {
      const { data } = await sb.from('tasks').select('*').eq('id', id).maybeSingle();
      return data ?? undefined;
    },
    async getTasksForLead(leadId) {
      const data = must(
        await sb.from('tasks').select('*').eq('lead_id', leadId).order('id')
      );
      return data;
    },
    async forceTasksDue(leadId) {
      // Test helper: make every pending task for a lead due now.
      must(
        await sb
          .from('tasks')
          .update({ due_at: new Date(Date.now() - 60000).toISOString() })
          .eq('lead_id', leadId)
          .is('sent_at', null)
      );
    },
  };
}

// ───────────────────────────── In-memory backend ────────────────────────────
function memoryBackend() {
  const leads = new Map(); // id -> lead
  const tasks = new Map(); // id -> task
  const cfg = new Map(); // key -> value
  const slackEvents = new Set();
  let leadSeq = 0;
  let taskSeq = 0;

  return {
    async getConfig(key) {
      return cfg.has(key) ? cfg.get(key) : null;
    },
    async setConfig(key, value) {
      cfg.set(key, String(value));
    },
    async claimSlackEvent(eventId) {
      if (!eventId) return true;
      if (slackEvents.has(eventId)) return false;
      slackEvents.add(eventId);
      return true;
    },
    async getLead(id) {
      return leads.get(Number(id));
    },
    async getLeadByExternalId(extId) {
      if (!extId) return undefined;
      for (const l of leads.values()) if (l.external_id === extId) return l;
      return undefined;
    },
    async insertLead(lead) {
      const id = ++leadSeq;
      const row = {
        id,
        status: 'new',
        consultation_booked: false,
        opted_out: false,
        closed: false,
        created_at: nowIso(),
        ...lead,
        raw: lead.raw ? JSON.parse(lead.raw) : null,
      };
      leads.set(id, row);
      return row;
    },
    async setLeadFlag(id, flag) {
      const lead = leads.get(Number(id));
      if (!lead) return false;
      lead[flag] = true;
      lead.status = flag;
      return true;
    },
    async cancelPendingTasks(leadId) {
      let n = 0;
      for (const t of tasks.values()) {
        if (t.lead_id === Number(leadId) && !t.sent_at && !t.cancelled) {
          t.cancelled = true;
          n++;
        }
      }
      return n;
    },
    async insertTask(leadId, type, channel, dueAtIso) {
      const id = ++taskSeq;
      tasks.set(id, {
        id,
        lead_id: Number(leadId),
        type,
        channel,
        due_at: dueAtIso,
        sent_at: null,
        cancelled: false,
        error: null,
        attempts: 0,
        created_at: nowIso(),
      });
      return id;
    },
    async getDueTasks(limit = 50) {
      const now = nowIso();
      return [...tasks.values()]
        .filter((t) => !t.sent_at && !t.cancelled && t.due_at <= now)
        .sort((a, b) => (a.due_at < b.due_at ? -1 : 1))
        .slice(0, limit);
    },
    async markTaskSent(id) {
      const t = tasks.get(Number(id));
      if (t) {
        t.sent_at = nowIso();
        t.attempts++;
        t.error = null;
      }
    },
    async markTaskError(id, err) {
      const t = tasks.get(Number(id));
      if (t) {
        t.attempts++;
        t.error = String(err).slice(0, 500);
      }
    },
    async getTask(id) {
      return tasks.get(Number(id));
    },
    async getTasksForLead(leadId) {
      return [...tasks.values()]
        .filter((t) => t.lead_id === Number(leadId))
        .sort((a, b) => a.id - b.id);
    },
    async forceTasksDue(leadId) {
      const past = new Date(Date.now() - 60000).toISOString();
      for (const t of tasks.values()) {
        if (t.lead_id === Number(leadId) && !t.sent_at) t.due_at = past;
      }
    },
  };
}

// ───────────────────────────── Select backend ───────────────────────────────
const backend = config.ready.supabase ? supabaseBackend() : memoryBackend();

if (config.ready.supabase) {
  logger.info('Database: Supabase', { url: config.supabase.url });
} else {
  logger.warn(
    'Database: in-memory fallback (SUPABASE_URL / SERVICE_ROLE_KEY not set). ' +
      'Data is NOT persisted across restarts — set Supabase creds for production.'
  );
}

// Re-export the chosen backend's methods as named async functions.
export const getConfig = (...a) => backend.getConfig(...a);
export const setConfig = (...a) => backend.setConfig(...a);
export const claimSlackEvent = (...a) => backend.claimSlackEvent(...a);
export const getLead = (...a) => backend.getLead(...a);
export const getLeadByExternalId = (...a) => backend.getLeadByExternalId(...a);
export const insertLead = (...a) => backend.insertLead(...a);
export const setLeadFlag = (...a) => backend.setLeadFlag(...a);
export const cancelPendingTasks = (...a) => backend.cancelPendingTasks(...a);
export const insertTask = (...a) => backend.insertTask(...a);
export const getDueTasks = (...a) => backend.getDueTasks(...a);
export const markTaskSent = (...a) => backend.markTaskSent(...a);
export const markTaskError = (...a) => backend.markTaskError(...a);
export const getTask = (...a) => backend.getTask(...a);
export const getTasksForLead = (...a) => backend.getTasksForLead(...a);
export const forceTasksDue = (...a) => backend.forceTasksDue(...a);

export default backend;
