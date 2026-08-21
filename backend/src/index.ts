import "reflect-metadata";
import { bootstrapNestApplication } from "./nest/bootstrap";

async function start() {
  await bootstrapNestApplication();
}

start().catch((error) => {
  console.error("Не удалось запустить backend", error);
  process.exit(1);
});
