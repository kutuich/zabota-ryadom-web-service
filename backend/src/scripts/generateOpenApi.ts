import fs from "node:fs/promises";
import path from "node:path";
import { createNestApplication } from "../nest/bootstrap";
import { buildOpenApiDocument, documentedApiOperations } from "../nest/openapi/openapi";

async function main() {
  const app = await createNestApplication({ startScheduler: false, exposeOpenApi: false });
  try {
    const document = buildOpenApiDocument(app);
    const outputPath = path.resolve(process.cwd(), "generated/openapi.json");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    console.log(`Generated ${documentedApiOperations(document).length} OpenAPI operations at ${outputPath}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
