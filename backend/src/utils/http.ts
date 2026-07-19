import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function sendError(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      details: error.details
    });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: "Проверьте заполнение формы",
      code: "validation_error",
      details: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  console.error(error);
  return res.status(500).json({
    error: "Внутренняя ошибка сервера",
    code: "internal_error"
  });
}
