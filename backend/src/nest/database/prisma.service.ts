import { Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { prisma } from "../../db/prisma";

@Injectable()
export class PrismaService implements OnModuleInit, OnApplicationShutdown {
  readonly client = prisma;

  async onModuleInit() {
    await this.client.$connect();
  }

  async onApplicationShutdown() {
    await this.client.$disconnect();
  }
}
