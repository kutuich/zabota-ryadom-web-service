import express from "express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter, type NestExpressApplication } from "@nestjs/platform-express";
import { env } from "../config/env";
import { initializeErrorTracking, type ErrorTracker } from "../observability/error-tracker";
import { createHttpObservabilityMiddleware } from "../observability/http-observability.middleware";
import { appLogger, NestStructuredLogger, type StructuredLogger } from "../observability/logger";
import { AppModule } from "./app.module";
import { NestHttpExceptionFilter } from "./common/nest-http-exception.filter";
import { ZodValidationPipe } from "./common/zod-validation.pipe";
import { ApplicationLifecycleService } from "./infrastructure/application-lifecycle.service";
import { buildOpenApiDocument, exposeOpenApi } from "./openapi/openapi";

export type NestApplicationOptions = {
  startScheduler?: boolean;
  exposeOpenApi?: boolean;
  logger?: StructuredLogger;
  errorTracker?: ErrorTracker;
};

export async function createNestApplication(options: NestApplicationOptions = {}) {
  const server = express();
  const logger = options.logger ?? appLogger;
  const errorTracker = options.errorTracker ?? initializeErrorTracking();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    { bodyParser: false, logger: new NestStructuredLogger(logger) }
  );
  app.enableCors({ origin: env.corsOrigin, credentials: true });
  app.useGlobalFilters(new NestHttpExceptionFilter(logger, errorTracker));
  app.useGlobalPipes(new ZodValidationPipe());
  app.enableShutdownHooks();
  app.get(ApplicationLifecycleService).configure({ startScheduler: options.startScheduler ?? true, errorTracker });

  server.use(createHttpObservabilityMiddleware(logger));
  const serviceConversationJson = express.json({ limit: "70mb" });
  const defaultJson = express.json({ limit: "8mb" });
  server.use((req, res, next) => {
    const parser = req.path.startsWith("/api/admin/service-conversations")
      ? serviceConversationJson
      : defaultJson;
    parser(req, res, next);
  });
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
  appLogger.info("application.started", { port: env.port });
  return app;
}
