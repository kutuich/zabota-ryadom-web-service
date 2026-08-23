import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../../utils/http";
import { getErrorTracker, type ErrorTracker } from "../../observability/error-tracker";
import { appLogger, type StructuredLogger } from "../../observability/logger";
import { safeError } from "../../observability/redaction";

@Catch()
export class NestHttpExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: StructuredLogger = appLogger,
    private readonly errorTracker: ErrorTracker = getErrorTracker()
  ) {}

  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message, code: error.code, details: error.details });
      return;
    }
    if (error instanceof ZodError) {
      response.status(400).json({
        error: "Проверьте заполнение формы",
        code: "validation_error",
        details: { validationErrors: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }
      });
      return;
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      if (status >= 500) this.reportUnexpected(error, request, status);
      response.status(status).json(typeof body === "string" ? { error: body, code: `http_${status}` } : body);
      return;
    }
    this.reportUnexpected(error, request, HttpStatus.INTERNAL_SERVER_ERROR);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Внутренняя ошибка сервера", code: "internal_error" });
  }

  private reportUnexpected(error: unknown, request: Request, statusCode: number) {
    this.logger.error("http.request.unhandled_error", {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      statusCode,
      error: safeError(error)
    });
    this.errorTracker.captureException(error, {
      event: "http.request.unhandled_error",
      requestId: request.requestId
    });
  }
}
