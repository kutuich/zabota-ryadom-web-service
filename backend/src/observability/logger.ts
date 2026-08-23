import type { LoggerService } from "@nestjs/common";
import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";
import { env } from "../config/env";
import { getCorrelationContext } from "./request-context";
import { redactSensitive, safeError } from "./redaction";

export type LogFields = Record<string, unknown>;

export interface StructuredLogger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createStructuredLogger(options: {
  environment?: string;
  level?: string;
  service?: string;
  stream?: DestinationStream;
} = {}): StructuredLogger {
  const instance = pino({
    base: {
      service: options.service ?? "zabota-ryadom-backend",
      environment: options.environment ?? env.nodeEnv
    },
    level: options.level ?? process.env.LOG_LEVEL ?? (env.nodeEnv === "test" ? "silent" : "info"),
    formatters: { level: (label) => ({ level: label }) },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`
  }, options.stream);
  return new PinoStructuredLogger(instance);
}

class PinoStructuredLogger implements StructuredLogger {
  constructor(private readonly logger: PinoLogger) {}

  debug(event: string, fields: LogFields = {}) { this.write("debug", event, fields); }
  info(event: string, fields: LogFields = {}) { this.write("info", event, fields); }
  warn(event: string, fields: LogFields = {}) { this.write("warn", event, fields); }
  error(event: string, fields: LogFields = {}) { this.write("error", event, fields); }

  private write(level: "debug" | "info" | "warn" | "error", event: string, fields: LogFields) {
    const context = getCorrelationContext();
    this.logger[level](redactSensitive({ ...fields, ...context, event }), event);
  }
}

export class NestStructuredLogger implements LoggerService {
  constructor(private readonly logger: StructuredLogger) {}

  log(message: unknown, context?: string) {
    this.logger.info("nest.log", { context, message: normalizeMessage(message) });
  }

  error(message: unknown, traceOrContext?: string, context?: string) {
    this.logger.error("nest.error", {
      context: context ?? safeNestContext(traceOrContext),
      error: message instanceof Error ? safeError(message) : undefined,
      message: normalizeMessage(message)
    });
  }

  warn(message: unknown, context?: string) {
    this.logger.warn("nest.warn", { context, message: normalizeMessage(message) });
  }

  debug(message: unknown, context?: string) {
    this.logger.debug("nest.debug", { context, message: normalizeMessage(message) });
  }

  verbose(message: unknown, context?: string) {
    this.logger.debug("nest.verbose", { context, message: normalizeMessage(message) });
  }

  fatal(message: unknown, context?: string) {
    this.logger.error("nest.fatal", { context, message: normalizeMessage(message) });
  }
}

function normalizeMessage(message: unknown) {
  if (message instanceof Error) return safeError(message);
  if (typeof message === "string") return message;
  return redactSensitive(message);
}

function safeNestContext(value: string | undefined) {
  return value && value.length <= 120 && !value.includes("\n") ? value : undefined;
}

export const appLogger = createStructuredLogger();
