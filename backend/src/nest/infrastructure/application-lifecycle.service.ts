import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { ensureFixedServiceFeeSettings } from "../../services/balanceService";
import { ensureFederalCategoryStructure } from "../../services/categoryStructureService";
import { ensureLegalDocuments } from "../../services/legalService";
import { ensureSettlementDirectory } from "../../services/settlementService";
import { ensureUploadsRoot } from "../../services/uploadStorage";
import { visitReconciliationScheduler } from "../../services/visitReconciliationScheduler";
import { getErrorTracker, type ErrorTracker } from "../../observability/error-tracker";

@Injectable()
export class ApplicationLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private startScheduler = true;
  private errorTracker: ErrorTracker = getErrorTracker();

  configure(options: { startScheduler: boolean; errorTracker?: ErrorTracker }) {
    this.startScheduler = options.startScheduler;
    if (options.errorTracker) this.errorTracker = options.errorTracker;
  }

  async onApplicationBootstrap() {
    await ensureLegalDocuments();
    await ensureSettlementDirectory();
    await ensureFederalCategoryStructure();
    await ensureFixedServiceFeeSettings();
    await ensureUploadsRoot();
    if (this.startScheduler) visitReconciliationScheduler.start();
  }

  async onApplicationShutdown() {
    visitReconciliationScheduler.stop();
    await this.errorTracker.flush(2000);
  }
}
