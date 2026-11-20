import { createServer } from 'node:http';
import { BcClient } from './bc/bc-client.js';
import { BcSyncService } from './bc/bc-sync.service.js';
import { BcTransferWorker } from './bc/transfer-worker.js';
import { loadConfig } from './config.js';
import { assertDbRole } from './db/role-check.js';
import { createDb } from './db/client.js';
import { applyRetention, flagForgottenClockOuts, snapshotProductivity } from './jobs.js';
import { AuditService } from './common/audit.service.js';
import { AbsenceService } from './modules/absence/absence.service.js';
import { ApprovalsService } from './modules/approvals/approvals.service.js';
import { runAutoApprove } from './modules/approvals/auto-approve.js';
import { ReportService } from './modules/docs/report.service.js';
import { TimeService } from './modules/time/time.service.js';
import { TransferService } from './modules/transfer/transfer.service.js';
import { resolve } from 'node:path';
import { AzureBlobStorage, LocalBlobStorage } from './modules/files/blob-storage.js';
import {
  deliverPush,
  remindForgottenClockOut,
  webPushSender,
  type PushSender,
} from './modules/files/push.js';

/**
 * Background worker (separate process, DB role monteur_worker): BC delta sync, BC transfer queue (phase 3),
 * reminders and retention jobs.
 */
const config = loadConfig({ ...process.env, COMPONENT: 'worker' });
await assertDbRole(config.DATABASE_URL, 'worker', config.APP_ENV === 'prod' || !!config.CONTAINER_APP_NAME);
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

// Automatic hand-over to BC without a Meister approval in the app (E-66).
const transfers = new TransferService();
const audit = new AuditService();
const approvals = new ApprovalsService(
  db,
  new TimeService(),
  transfers,
  audit,
  new ReportService(),
  new AbsenceService(db, transfers, audit),
);

const storage =
  config.STORAGE_MODE === 'azure'
    ? new AzureBlobStorage(config.STORAGE_ACCOUNT_URL!, config.STORAGE_CONTAINER)
    : new LocalBlobStorage(
        resolve(config.LOCAL_STORAGE_DIR),
        config.PUBLIC_API_URL,
        'worker-has-no-signing-need',
      );
let pushSender: PushSender | null = null;
if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY)
  pushSender = await webPushSender(config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY, config.VAPID_SUBJECT);
else console.warn('[worker] VAPID keys missing – Web Push disabled (notifications stay in the app)');

const jobs: Array<{ name: string; intervalMs: number; run: () => Promise<unknown> }> = [
  { name: 'forgotten-clock-out-reminder', intervalMs: 5 * 60_000, run: () => remindForgottenClockOut(db) },
  ...(pushSender ? [{ name: 'web-push', intervalMs: 20_000, run: () => deliverPush(db, pushSender!) }] : []),
  { name: 'retention', intervalMs: 6 * 3_600_000, run: () => applyRetention(db, (p) => storage.delete(p)) },
  {
    name: 'auto-approve',
    intervalMs: Number(process.env.AUTO_APPROVE_INTERVAL_SEC ?? 60) * 1000,
    run: () => runAutoApprove(db, approvals),
  },
  { name: 'bc-transfer', intervalMs: 15_000, run: () => bcTransfer.runOnce() },
  { name: 'bc-sync', intervalMs: config.BC_SYNC_INTERVAL_SEC * 1000, run: () => bcSync.runAll() },
  { name: 'bc-refresh', intervalMs: 10_000, run: () => bcSync.processRefreshRequests() },
  { name: 'forgotten-clock-out', intervalMs: 15 * 60_000, run: () => flagForgottenClockOuts(db) },
  { name: 'productivity-snapshot', intervalMs: 6 * 3_600_000, run: () => snapshotProductivity(db) },
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
