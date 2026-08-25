import cron from 'node-cron';
import logger from './logger.js';
import { getDueTasks } from './db.js';
import { safeDispatch } from './leads/sequence.js';

/**
 * Poll for due tasks every minute and dispatch them. Immediate (Day 0) sends
 * are also picked up here on the next tick; for zero-latency Day-0 delivery the
 * ingest route additionally kicks a drain right after enrolling a lead.
 */
let draining = false;

export async function drainDueTasks() {
  if (draining) return; // avoid overlapping runs
  draining = true;
  try {
    const due = await getDueTasks(100);
    if (due.length) {
      logger.info('Draining due tasks', { count: due.length });
    }
    for (const task of due) {
      await safeDispatch(task);
    }
  } catch (err) {
    logger.error('Scheduler drain error', { error: err.message });
  } finally {
    draining = false;
  }
}

export function startScheduler() {
  // Every minute.
  cron.schedule('* * * * *', drainDueTasks);
  logger.info('Scheduler started (every minute)');
  // Kick once at boot so anything overdue after downtime goes out promptly.
  drainDueTasks();
}
