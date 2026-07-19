import { disconnectDemoPrisma, seedDemoDatabase } from "./demoData";

seedDemoDatabase({ reset: false })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDemoPrisma();
  });
