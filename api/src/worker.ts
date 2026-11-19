import { createServer } from 'node:http';
import { BcClient } from './bc/bc-client.js';
import { BcSyncService } from './bc/bc-sync.service.js';
import { BcTransferWorker } from './bc/transfer-worker.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { flagForgottenClockOuts } from './jobs.js';

/**
 * Background worker (separate process, DB role monteur_worker): BC delta sync, BC transfer queue (phase 3),
 * reminders and retention jobs.
 */
const config = loadConfig({ ...process.env, COMPONENT: 'worker' });
const { db, pool } = createDb(config.DATABASE_URL, 5);
const clients = new Map<string, BcClient>();
const clientFor = (companyId: string) => {
  let c = clients.get(companyId);
  if (!c) {
    c = new BcClient({
      apiBaseUrl: config.BC_API_BASE_URL,
      tokenUrl: config.BC_TOKEN_URL,
      clientId: config.BC_CLIENT_ID,
      clientSecret: config.BC_CLIENT_SECRET,
      scope: config.BC_SCOPE,
      companyId,
    });
    clients.set(companyId, c);
  }
  return c;
};
const bcSync = new BcSyncService(db, clientFor, (m) => console.warn(m));
const bcTransfer = new BcTransferWorker(db, clientFor, (m) => console.warn(m));

const jobs: Array<{ name: string; intervalMs: number; run: () => Promise<unknown> }> = [
  { name: 'bc-transfer', intervalMs: 15_000, run: () => bcTransfer.runOnce() },
  { name: 'bc-sync', intervalMs: config.BC_SYNC_INTERVAL_SEC * 1000, run: () => bcSync.runAll() },
  { name: 'forgotten-clock-out', intervalMs: 15 * 60_000, run: () => flagForgottenClockOuts(db) },
];
const timers: NodeJS.Timeout[] = [];
const running = new Set<string>();
const lastOk = new Map<string, number>();

const runJob = async (job: (typeof jobs)[number]) => {
  if (running.has(job.name)) return; // never overlap the same job
  running.add(job.name);
  const t0 = Date.now();
  try {
    const result = await job.run();
    lastOk.set(job.name, Date.now());
    console.log(`[worker] ${job.name} ok in ${Date.now() - t0} ms ${JSON.stringify(result)}`);
  } catch (e) {
    console.error(`[worker] ${job.name} failed`, e);
  } finally {
    running.delete(job.name);
  }
};
for (const job of jobs) {
  void runJob(job);
  timers.push(setInterval(() => void runJob(job), job.intervalMs));
}

const health = createServer((req, res) => {
  if (req.url === '/health/live') return res.writeHead(200).end();
  if (req.url === '/health/ready')
    return res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(Object.fromEntries(lastOk)));
  res.writeHead(404).end();
}).listen(Number(process.env.WORKER_HEALTH_PORT ?? 4001));

const shutdown = async () => {
  timers.forEach(clearInterval);
  health.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
console.log(
  `[worker] started (env=${config.APP_ENV}, bc=${config.BC_MODE}, jobs=${jobs.map((j) => j.name).join(', ')})`,
);
