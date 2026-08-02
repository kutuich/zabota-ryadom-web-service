import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/db/prisma";
import { createDraftFromImport, type CategoryImportPayload } from "../src/services/categoryStructureService";

async function main() {
  const base = JSON.parse(readFileSync(path.resolve(process.cwd(), "backend/prisma/structures/service-tree-v3-base.json"), "utf8")) as CategoryImportPayload;
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "superadmin", status: "active" } });
  const region = await prisma.region.findUniqueOrThrow({ where: { slug: "hmao-yugra" } });
  const city = await prisma.city.findUniqueOrThrow({ where: { slug: "yugorsk" } });
  const targets: Array<{ fileName: string; payload: CategoryImportPayload }> = [
    { fileName: "service-tree-russia-v3.json", payload: structuredClone(base) },
    { fileName: "service-tree-khmao-v3.json", payload: { ...structuredClone(base), scope: { type: "region", regionId: region.id }, passport: { ...base.passport, title: "Дерево услуг ХМАО — Югра", versionNumber: "3.0" } } },
    { fileName: "service-tree-yugorsk-v3.json", payload: { ...structuredClone(base), scope: { type: "city", cityId: city.id }, passport: { ...base.passport, title: "Дерево услуг Югорска", versionNumber: "3.0" } } }
  ];
  for (const target of targets) {
    const scopeKey = target.payload.scope.type === "federal" ? "federal" : target.payload.scope.type === "region" ? `region:${region.id}` : `city:${city.id}`;
    const exists = await prisma.categoryStructure.findUnique({ where: { scopeKey_versionNumber: { scopeKey, versionNumber: "3.0" } } });
    if (!exists) await createDraftFromImport(target.payload, admin.id, target.fileName);
  }
  console.log("Service tree v3 drafts imported for РФ, ХМАО — Югра and Югорск. Activation was not performed.");
}

main().finally(() => prisma.$disconnect());
