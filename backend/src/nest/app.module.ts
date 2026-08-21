import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { InfrastructureModule } from "./infrastructure/infrastructure.module";
import { StaticDeliveryModule } from "./static/static-delivery.module";
import {
  AdminModule,
  AgreementsModule,
  AuthModule,
  CatalogModule,
  CommunicationsModule,
  FilesModule,
  FinanceModule,
  LegalModule,
  PaymentsModule,
  PublicModule,
  RequestsModule,
  UsersModule
} from "./domains/domain-modules";

@Module({
  imports: [
    InfrastructureModule,
    HealthModule,
    PublicModule,
    AuthModule,
    LegalModule,
    UsersModule,
    CatalogModule,
    RequestsModule,
    AgreementsModule,
    FinanceModule,
    PaymentsModule,
    CommunicationsModule,
    FilesModule,
    AdminModule,
    StaticDeliveryModule
  ]
})
export class AppModule {}
