import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { ensureFixedServiceFeeSettings } from "../../services/balanceService";
import { ensureFederalCategoryStructure } from "../../services/categoryStructureService";
import { ensureLegalDocuments } from "../../services/legalService";
import { ensureSettlementDirectory } from "../../services/settlementService";
import { ensureUploadsRoot } from "../../services/uploadStorage";
import { visitReconciliationScheduler } from "../../services/visitReconciliationScheduler";

@Injectable()
export class ApplicationLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private startScheduler = true;

  configure(options: { startScheduler: boolean }) {
    this.startScheduler = options.startScheduler;
  }

  async onApplicationBootstrap() {
    await ensureLegalDocuments();
    await ensureSettlementDirectory();
    await ensureFederalCategoryStructure();
    await ensureFixedServiceFeeSettings();
    await ensureUploadsRoot();
    if (this.startScheduler) visitReconciliationScheduler.start();
  }

  onApplicationShutdown() {
    visitReconciliationScheduler.stop();
  }
}
