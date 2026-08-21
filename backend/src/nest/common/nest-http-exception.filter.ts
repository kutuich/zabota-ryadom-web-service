import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../../utils/http";

@Catch()
export class NestHttpExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
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
      response.status(status).json(typeof body === "string" ? { error: body, code: `http_${status}` } : body);
      return;
    }
    console.error(error);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Внутренняя ошибка сервера", code: "internal_error" });
  }
}
