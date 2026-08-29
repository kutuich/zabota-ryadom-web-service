import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { appLogger, type StructuredLogger } from "./logger";
import { runWithCorrelationContext } from "./request-context";

export const REQUEST_ID_HEADER = "x-request-id";
const validRequestId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function resolveRequestId(value: unknown) {
  return typeof value === "string" && validRequestId.test(value) ? value : randomUUID();
}

export function createHttpObservabilityMiddleware(logger: StructuredLogger = appLogger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    const startedAt = process.hrtime.bigint();
    req.requestId = requestId;
    req.headers[REQUEST_ID_HEADER] = requestId;
    res.setHeader("X-Request-Id", requestId);

    runWithCorrelationContext({ correlationId: requestId, requestId }, () => {
      let logged = false;
      const complete = (event: "http.request.completed" | "http.request.aborted") => {
        if (logged) return;
        logged = true;
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        logger.info(event, {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100
        });
      };
      res.once("finish", () => complete("http.request.completed"));
      res.once("close", () => {
        if (!res.writableEnded) complete("http.request.aborted");
      });
      next();
    });
  };
}
