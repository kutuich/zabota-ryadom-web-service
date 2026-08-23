import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { ApiZodResponse } from "../openapi/zod-openapi";
import { ReadinessService } from "./readiness.service";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("zabota-ryadom-web-service")
});

@Controller("api/health")
export class HealthController {
  @Get()
  @ApiZodResponse(200, healthResponseSchema, "Service health")
  getHealth() {
    return healthResponseSchema.parse({ status: "ok", service: "zabota-ryadom-web-service" });
  }
}

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.literal("zabota-ryadom-web-service"),
  checks: z.object({
    postgres: z.enum(["ok", "error"]),
    objectStorage: z.enum(["ok", "error", "skipped"])
  })
});

@Controller("api/ready")
export class ReadinessController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  @Get()
  @ApiZodResponse(200, readinessResponseSchema, "Critical runtime dependencies are ready")
  @ApiZodResponse(503, readinessResponseSchema, "One or more critical runtime dependencies are unavailable")
  async getReadiness(@Res() response: Response) {
    const result = readinessResponseSchema.parse(await this.readiness.check());
    return response.status(result.status === "ready" ? 200 : 503).json(result);
  }
}
