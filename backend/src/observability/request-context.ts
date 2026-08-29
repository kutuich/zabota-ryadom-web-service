import { AsyncLocalStorage } from "node:async_hooks";

export type CorrelationContext = {
  correlationId: string;
  requestId?: string;
  jobId?: string;
  jobName?: string;
};

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function runWithCorrelationContext<T>(context: CorrelationContext, callback: () => T): T {
  return correlationStorage.run(context, callback);
}

export function getCorrelationContext() {
  return correlationStorage.getStore();
}

export function getCorrelationId() {
  return correlationStorage.getStore()?.correlationId;
}
