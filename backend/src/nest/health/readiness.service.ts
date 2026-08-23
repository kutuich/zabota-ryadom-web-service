import { Inject, Injectable } from "@nestjs/common";
import { env } from "../../config/env";
import { appLogger } from "../../observability/logger";
import { objectStorage, storageProviderName } from "../../storage/storageProvider";
import { PrismaService } from "../database/prisma.service";

export type ReadinessResult = {
  status: "ready" | "not_ready";
  service: "zabota-ryadom-web-service";
  checks: {
    postgres: "ok" | "error";
    objectStorage: "ok" | "error" | "skipped";
  };
};

@Injectable()
export class ReadinessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async check(): Promise<ReadinessResult> {
    const result = await checkReadinessDependencies({
      postgres: () => this.prisma.client.$queryRawUnsafe("SELECT 1"),
      objectStorage: () => objectStorage.initialize(),
      objectStorageRequired: storageProviderName === "s3",
      timeoutMs: env.readinessTimeoutMs
    });
    if (result.status === "not_ready") {
      appLogger.warn("application.readiness_failed", {
        checks: result.checks
      });
    }
    return result;
  }
}

export async function checkReadinessDependencies(input: {
  postgres: () => Promise<unknown>;
  objectStorage: () => Promise<unknown>;
  objectStorageRequired: boolean;
  timeoutMs: number;
}): Promise<ReadinessResult> {
  const [postgres, objectStorageStatus] = await Promise.all([
    dependencyCheck(input.postgres, input.timeoutMs),
    input.objectStorageRequired
      ? dependencyCheck(input.objectStorage, input.timeoutMs)
      : Promise.resolve<"skipped">("skipped")
  ]);
  const ready = postgres === "ok" && objectStorageStatus !== "error";
  return {
    status: ready ? "ready" : "not_ready",
    service: "zabota-ryadom-web-service",
    checks: { postgres, objectStorage: objectStorageStatus }
  };
}

async function dependencyCheck(action: () => Promise<unknown>, timeoutMs: number): Promise<"ok" | "error"> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      action(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("readiness_timeout")), timeoutMs);
        timeout.unref?.();
      })
    ]);
    return "ok";
  } catch {
    return "error";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
