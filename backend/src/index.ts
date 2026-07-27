import { env } from "./config/env";
import { createApp } from "./app";
import { ensureLegalDocuments } from "./services/legalService";
import { ensureSettlementDirectory } from "./services/settlementService";
import { ensureFixedServiceFeeSettings } from "./services/balanceService";
import { ensureUploadsRoot } from "./services/uploadStorage";

async function start() {
  await ensureLegalDocuments();
  await ensureSettlementDirectory();
  await ensureFixedServiceFeeSettings();
  await ensureUploadsRoot();
  const app = createApp();

  app.listen(env.port, "0.0.0.0", () => {
    console.log(`Zabota Ryadom API listening on http://0.0.0.0:${env.port}`);
  });
}

start().catch((error) => {
  console.error("Не удалось подготовить обязательные юридические документы", error);
  process.exit(1);
});
