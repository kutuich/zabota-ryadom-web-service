import { randomUUID } from "node:crypto";
import express from "express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter, type NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import { AppModule } from "./app.module";
import { NestHttpExceptionFilter } from "./common/nest-http-exception.filter";
import { ZodValidationPipe } from "./common/zod-validation.pipe";
import { ApplicationLifecycleService } from "./infrastructure/application-lifecycle.service";
import { buildOpenApiDocument, exposeOpenApi } from "./openapi/openapi";

export type NestApplicationOptions = {
  startScheduler?: boolean;
  exposeOpenApi?: boolean;
};

export async function createNestApplication(options: NestApplicationOptions = {}) {
  const server = express();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    { bodyParser: false }
  );
  app.enableCors({ origin: env.corsOrigin, credentials: true });
  app.useGlobalFilters(new NestHttpExceptionFilter());
  app.useGlobalPipes(new ZodValidationPipe());
  app.enableShutdownHooks();
  app.get(ApplicationLifecycleService).configure({ startScheduler: options.startScheduler ?? true });

  server.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : randomUUID();
    req.headers["x-request-id"] = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  });
  server.use("/api/admin/service-conversations", express.json({ limit: "70mb" }));
  server.use(express.json({ limit: "8mb" }));
  if (options.exposeOpenApi ?? true) {
    const document = buildOpenApiDocument(app);
    exposeOpenApi(app, document, {
      jsonEnabled: env.openApiJsonEnabled,
      uiEnabled: env.swaggerUiEnabled
    });
  }
  await app.init();
  return app;
}

export async function bootstrapNestApplication() {
  const app = await createNestApplication();
  await app.listen(env.port, "0.0.0.0");
  console.log(`Zabota Ryadom NestJS API listening on http://0.0.0.0:${env.port}`);
  return app;
}
