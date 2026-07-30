import { env } from "./config/env";
import { createApp } from "./app";
import { ensureLegalDocuments } from "./services/legalService";
import { ensureSettlementDirectory } from "./services/settlementService";
import { ensureFixedServiceFeeSettings } from "./services/balanceService";
import { ensureUploadsRoot } from "./services/uploadStorage";
import { ensureFederalCategoryStructure } from "./services/categoryStructureService";
import { visitReconciliationScheduler } from "./services/visitReconciliationScheduler";

async function start() {
  await ensureLegalDocuments();
  await ensureSettlementDirectory();
  await ensureFederalCategoryStructure();
  await ensureFixedServiceFeeSettings();
  await ensureUploadsRoot();
  const app = createApp();

  const server = app.listen(env.port, "0.0.0.0", () => {
    console.log(`Zabota Ryadom API listening on http://0.0.0.0:${env.port}`);
    visitReconciliationScheduler.start();
  });
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, stopping application.`);
    visitReconciliationScheduler.stop();
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  console.error("Не удалось подготовить обязательные юридические документы", error);
  process.exit(1);
});
