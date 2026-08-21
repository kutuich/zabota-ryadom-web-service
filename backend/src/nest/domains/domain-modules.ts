import { Global, Module } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestJwtAuthGuard, NestRolesGuard } from "../common/auth.guards";
import { AccountSecurityController, TemporaryPasswordController } from "./controllers/accountSecurity.controller";
import { AdminController } from "./controllers/admin.controller";
import { AgreementContractsController } from "./controllers/agreementContracts.controller";
import { AuthController } from "./controllers/auth.controller";
import { BalanceController } from "./controllers/balance.controller";
import {
  AdminCategoryStructuresController,
  CategoriesController,
  CategoryStructuresController,
  HelperCategoryPreferencesController
} from "./controllers/categoryStructures.controller";
import { ChatsController } from "./controllers/chats.controller";
import { ComplaintsController } from "./controllers/complaints.controller";
import { KnowledgeController } from "./controllers/knowledge.controller";
import { LegalController } from "./controllers/legal.controller";
import { ManagerController } from "./controllers/manager.controller";
import { MeCitiesController } from "./controllers/meCities.controller";
import { NpdRegisterController } from "./controllers/npdRegister.controller";
import { AdminPaymentsController, PaymentsController } from "./controllers/payments.controller";
import { PerformerDocumentsController } from "./controllers/performerDocuments.controller";
import { PerformerProfileController } from "./controllers/performerProfile.controller";
import { PricingController } from "./controllers/pricing.controller";
import { PublicController } from "./controllers/public.controller";
import { RequestDraftSupportController, RequestDraftsController } from "./controllers/requestDrafts.controller";
import { RequestsController } from "./controllers/requests.controller";
import {
  AdminBroadcastsController,
  AdminServiceConversationsController,
  MeServiceMessagesController,
  PaymentServiceMessagesController,
  ServiceMessageAttachmentsController
} from "./controllers/serviceCommunications.controller";
import { SettlementsController } from "./controllers/settlements.controller";
import { AdminVisitsController, VisitsController } from "./controllers/visits.controller";

@Module({ controllers: [PublicController, SettlementsController, PricingController, KnowledgeController] })
export class PublicModule {}

@Global()
@Module({
  controllers: [AuthController, AccountSecurityController, TemporaryPasswordController],
  providers: [NestJwtAuthGuard, NestRolesGuard, NestAdminGuard, NestAdminManagerGuard],
  exports: [NestJwtAuthGuard, NestRolesGuard, NestAdminGuard, NestAdminManagerGuard]
})
export class AuthModule {}

@Module({ controllers: [LegalController] })
export class LegalModule {}

@Module({ controllers: [MeCitiesController, PerformerProfileController, ManagerController] })
export class UsersModule {}

@Module({
  controllers: [CategoryStructuresController, CategoriesController, HelperCategoryPreferencesController]
})
export class CatalogModule {}

@Module({ controllers: [RequestsController, RequestDraftsController, ComplaintsController] })
export class RequestsModule {}

@Module({ controllers: [ChatsController, AgreementContractsController, VisitsController] })
export class AgreementsModule {}

@Module({ controllers: [BalanceController, NpdRegisterController] })
export class FinanceModule {}

@Module({ controllers: [PaymentsController, AdminPaymentsController] })
export class PaymentsModule {}

@Module({
  controllers: [
    AdminServiceConversationsController,
    AdminBroadcastsController,
    MeServiceMessagesController,
    PaymentServiceMessagesController
  ]
})
export class CommunicationsModule {}

@Module({ controllers: [PerformerDocumentsController, ServiceMessageAttachmentsController] })
export class FilesModule {}

@Module({
  controllers: [AdminController, AdminCategoryStructuresController, AdminVisitsController, RequestDraftSupportController]
})
export class AdminModule {}

export const NEST_ROUTE_OWNERSHIP = {
  PublicModule: ["public", "settlements", "pricing", "knowledge"],
  AuthModule: ["auth", "accountSecurity", "temporaryPassword"],
  LegalModule: ["legal"],
  UsersModule: ["meCities", "performerProfile", "manager"],
  CatalogModule: ["categoryStructures", "categories", "helperCategoryPreferences"],
  RequestsModule: ["requests", "requestDrafts", "complaints"],
  AgreementsModule: ["chats", "agreementContracts", "visits"],
  FinanceModule: ["balance", "npdRegister"],
  PaymentsModule: ["payments", "adminPayments"],
  CommunicationsModule: ["serviceConversations", "broadcasts", "paymentServiceMessages"],
  FilesModule: ["performerDocuments", "serviceMessageAttachments"],
  AdminModule: ["admin", "adminCategoryStructures", "adminVisits", "requestDraftSupport"]
} as const;
