import {
  assertTargetIsEmpty,
  buildVerificationReport,
  createClients,
  delegateName,
  modelDefinitions,
  parseRehearsalConfig,
  projectScalarData,
  writeVerificationReport,
  type RuntimeClient
} from "./databaseRehearsal";

const BATCH_SIZE = 250;

async function main() {
  const config = parseRehearsalConfig(process.argv.slice(2));
  const { source, target } = createClients(config);
  try {
    await source.user.count();
    await target.user.count();
    await assertTargetIsEmpty(target);

    const transferred = await target.$transaction(async (tx: RuntimeClient) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      const counts: Record<string, number> = {};
      for (const model of modelDefinitions) {
        const delegate = delegateName(model.name);
        const rows = await source[delegate].findMany();
        for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
          const batch = rows.slice(offset, offset + BATCH_SIZE).map((row: Record<string, unknown>) => projectScalarData(row, model));
          await tx[delegate].createMany({ data: batch });
        }
        counts[model.name] = rows.length;
      }
      return counts;
    }, { maxWait: 30_000, timeout: 30 * 60_000 });

    const report = await buildVerificationReport(source, target, config.targetLabel);
    writeVerificationReport({ transferred, verification: report }, config.reportPath);
    if (!report.passed) throw new Error(`Verification failed: ${report.failures.join("; ")}`);
    console.log(JSON.stringify({ transferred, verification: report.summary, target: config.targetLabel }, null, 2));
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
