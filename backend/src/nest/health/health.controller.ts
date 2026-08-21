import { Controller, Get } from "@nestjs/common";
import { z } from "zod";
import { ApiZodResponse } from "../openapi/zod-openapi";

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
