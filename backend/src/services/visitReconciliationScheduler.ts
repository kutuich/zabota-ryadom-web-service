import { env } from "../config/env";
import { writeAudit } from "./auditService";
import { reconcileDueVisits } from "./visitOperationsService";

export type VisitReconciliationDiagnostics = {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  lastStartedAt: string | null;
  lastSuccessfulAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  lastChecked: number;
  lastClosed: number;
  lastSkippedDisputed: number;
  nextRunAt: string | null;
};

type SchedulerOptions = {
  enabled?: boolean;
  intervalMinutes?: number;
  runOnStartup?: boolean;
  reconcile?: (now?: Date) => Promise<{ checked: number; closed: number; skippedDisputed?: number }>;
  now?: () => Date;
  logger?: Pick<Console, "info" | "error">;
};

export function createVisitReconciliationScheduler(options: SchedulerOptions = {}) {
  const enabled = options.enabled ?? env.visitReconciliationEnabled;
  const intervalMinutes = options.intervalMinutes ?? env.visitReconciliationIntervalMinutes;
  const runOnStartup = options.runOnStartup ?? env.visitReconciliationRunOnStartup;
  const reconcile = options.reconcile ?? ((now?: Date) => reconcileDueVisits(undefined, now));
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let started = false;
  const diagnostics: VisitReconciliationDiagnostics = {
    enabled,
    running: false,
    intervalMinutes,
    lastStartedAt: null,
    lastSuccessfulAt: null,
    lastFailedAt: null,
    lastError: null,
    lastChecked: 0,
    lastClosed: 0,
    lastSkippedDisputed: 0,
    nextRunAt: null
  };

  async function runOnce(source: "startup" | "interval" | "manual" = "manual") {
    if (running) return { skipped: true, reason: "already_running", checked: 0, closed: 0, skippedDisputed: 0 };
    running = true;
    diagnostics.running = true;
    diagnostics.lastStartedAt = now().toISOString();
    const startedAt = Date.now();
    logger.info(`[visit-reconciliation] run started source=${source}`);
    try {
      const result = await reconcile(now());
      diagnostics.lastSuccessfulAt = now().toISOString();
      diagnostics.lastError = null;
      diagnostics.lastChecked = result.checked;
      diagnostics.lastClosed = result.closed;
      diagnostics.lastSkippedDisputed = result.skippedDisputed ?? 0;
      await writeAudit(null, "request_visit.reconciliation_run", "visitReconciliation", null, {
        source,
        checked: result.checked,
        closed: result.closed,
        skippedDisputed: result.skippedDisputed ?? 0,
        durationMs: Date.now() - startedAt
      }).catch((error) => logger.error(`[visit-reconciliation] audit failed: ${safeError(error)}`));
      logger.info(`[visit-reconciliation] run completed checked=${result.checked} closed=${result.closed} skippedDisputed=${result.skippedDisputed ?? 0} durationMs=${Date.now() - startedAt}`);
      return { skipped: false, ...result };
    } catch (error) {
      diagnostics.lastFailedAt = now().toISOString();
      diagnostics.lastError = safeError(error);
      logger.error(`[visit-reconciliation] run failed: ${safeError(error)}`);
      throw error;
    } finally {
      running = false;
      diagnostics.running = false;
      diagnostics.nextRunAt = timer ? new Date(now().getTime() + intervalMinutes * 60_000).toISOString() : null;
    }
  }

  function start() {
    if (started || !enabled) {
      logger.info(`[visit-reconciliation] ${enabled ? "already started" : "disabled"}`);
      return;
    }
    started = true;
    logger.info(`[visit-reconciliation] enabled intervalMinutes=${intervalMinutes} runOnStartup=${runOnStartup}`);
    if (runOnStartup) void runOnce("startup").catch(() => undefined);
    timer = setInterval(() => void runOnce("interval").catch(() => undefined), intervalMinutes * 60_000);
    timer.unref?.();
    diagnostics.nextRunAt = new Date(now().getTime() + intervalMinutes * 60_000).toISOString();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    started = false;
    diagnostics.nextRunAt = null;
    logger.info("[visit-reconciliation] stopped");
  }

  return { start, stop, runOnce, getDiagnostics: () => ({ ...diagnostics }) };
}

export const visitReconciliationScheduler = createVisitReconciliationScheduler();

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "unknown_error";
}
