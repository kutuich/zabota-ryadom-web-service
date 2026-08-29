import "reflect-metadata";
import { bootstrapNestApplication } from "./nest/bootstrap";
import { appLogger } from "./observability/logger";
import { safeError } from "./observability/redaction";
import { getErrorTracker } from "./observability/error-tracker";

async function start() {
  await bootstrapNestApplication();
}

start().catch(async (error) => {
  appLogger.error("application.start_failed", { error: safeError(error) });
  const tracker = getErrorTracker();
  tracker.captureException(error, { event: "application.start_failed" });
  await tracker.flush(2000);
  process.exit(1);
});
