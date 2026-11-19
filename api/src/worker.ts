import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';

/**
 * Background worker: BC delta sync, BC transfer queue, reminders, retention jobs.
 * Jobs are registered in later phases; Phase 1 provides the process, health endpoint and graceful shutdown.
 */
const config = loadConfig();
const { pool } = createDb(config.DATABASE_URL, 5);
const jobs: Array<{ name: string; intervalMs: number; run: () => Promise<void> }> = [];
const timers: NodeJS.Timeout[] = [];

for (const job of jobs) {
  timers.push(
    setInterval(() => {
      job.run().catch((e) => console.error(`[worker] job ${job.name} failed`, e));
    }, job.intervalMs),
  );
}

const health = createServer((req, res) => {
  res.writeHead(req.url === '/health/live' ? 200 : 404).end();
}).listen(Number(process.env.WORKER_HEALTH_PORT ?? 4001));

const shutdown = async () => {
  timers.forEach(clearInterval);
  health.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
console.log(`[worker] started (env=${config.APP_ENV}, bc=${config.BC_MODE}, jobs=${jobs.length})`);
