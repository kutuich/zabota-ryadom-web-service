import * as Sentry from "@sentry/nestjs";
import type { ErrorEvent } from "@sentry/nestjs";
import { env, resolveBooleanFlag } from "../config/env";
import { appLogger } from "./logger";
import { getCorrelationContext } from "./request-context";
import { redactSensitive, redactString } from "./redaction";

export type ErrorCaptureContext = {
  requestId?: string;
  jobId?: string;
  jobName?: string;
  event: string;
};

export interface ErrorTracker {
  readonly enabled: boolean;
  captureException(error: unknown, context: ErrorCaptureContext): void;
  flush(timeoutMs?: number): Promise<boolean>;
}

type SentrySdk = Pick<typeof Sentry, "captureException" | "flush" | "init" | "withScope">;

class DisabledErrorTracker implements ErrorTracker {
  readonly enabled = false;
  captureException() {}
  async flush() { return true; }
}

class SentryErrorTracker implements ErrorTracker {
  readonly enabled = true;

  constructor(private readonly sdk: SentrySdk) {}

  captureException(error: unknown, context: ErrorCaptureContext) {
    const correlation = getCorrelationContext();
    this.sdk.withScope((scope) => {
      scope.setTag("event", context.event);
      const requestId = context.requestId ?? correlation?.requestId;
      const jobId = context.jobId ?? correlation?.jobId;
      const jobName = context.jobName ?? correlation?.jobName;
      if (requestId) scope.setTag("requestId", requestId);
      if (jobId) scope.setTag("jobId", jobId);
      if (jobName) scope.setTag("jobName", jobName);
      this.sdk.captureException(error);
    });
  }

  flush(timeoutMs = 2000) {
    return this.sdk.flush(timeoutMs);
  }
}

export function createErrorTracker(source: NodeJS.ProcessEnv = process.env, sdk: SentrySdk = Sentry): ErrorTracker {
  const dsn = source.SENTRY_DSN?.trim();
  const enabled = resolveBooleanFlag("SENTRY_ENABLED", Boolean(dsn), source) && Boolean(dsn);
  if (!enabled) return new DisabledErrorTracker();

  sdk.init({
    dsn,
    enabled: true,
    environment: source.SENTRY_ENVIRONMENT?.trim() || env.nodeEnv,
    release: source.SENTRY_RELEASE?.trim() || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [],
    beforeSend: scrubSentryEvent
  });
  return new SentryErrorTracker(sdk);
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed = redactSensitive(event);
  delete scrubbed.user;
  if (scrubbed.request) {
    scrubbed.request = {
      method: scrubbed.request.method,
      url: scrubbed.request.url ? scrubbed.request.url.split("?")[0] : undefined
    };
  }
  for (const exception of scrubbed.exception?.values ?? []) {
    if (exception.value) exception.value = redactString(exception.value);
  }
  for (const breadcrumb of scrubbed.breadcrumbs ?? []) {
    if (breadcrumb.message) breadcrumb.message = redactString(breadcrumb.message);
  }
  return scrubbed;
}

let activeErrorTracker: ErrorTracker | undefined;

export function initializeErrorTracking(source: NodeJS.ProcessEnv = process.env) {
  if (!activeErrorTracker) {
    activeErrorTracker = createErrorTracker(source);
    appLogger.info("error_tracking.configured", { provider: "sentry", enabled: activeErrorTracker.enabled });
  }
  return activeErrorTracker;
}

export function getErrorTracker() {
  return activeErrorTracker ?? initializeErrorTracking();
}
