import { Module } from "@nestjs/common";
import { PrismaModule } from "../database/prisma.module";
import { ApplicationLifecycleService } from "./application-lifecycle.service";

@Module({ imports: [PrismaModule], providers: [ApplicationLifecycleService], exports: [ApplicationLifecycleService] })
export class InfrastructureModule {}
