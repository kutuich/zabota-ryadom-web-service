import {
  buildVerificationReport,
  createClients,
  parseRehearsalConfig,
  writeVerificationReport
} from "./databaseRehearsal";

async function main() {
  const config = parseRehearsalConfig(process.argv.slice(2));
  const { source, target } = createClients(config);
  try {
    const report = await buildVerificationReport(source, target, config.targetLabel);
    writeVerificationReport(report, config.reportPath);
    console.log(JSON.stringify({ passed: report.passed, summary: report.summary, failures: report.failures, critical: report.critical }, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
