import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Prisma as PostgresPrisma,
  PrismaClient as PostgresPrismaClient
} from "@prisma/client";
import {
  Prisma as SqlitePrisma,
  PrismaClient as SqlitePrismaClient
} from "@prisma/sqlite-source-client";

type RuntimeClient = Record<string, any> & {
  $disconnect(): Promise<void>;
  $executeRawUnsafe(query: string): Promise<unknown>;
};

type ModelDefinition = (typeof SqlitePrisma.dmmf.datamodel.models)[number];
type ForeignKeyReport = {
  model: string;
  fields: readonly string[];
  references: string;
  sourceViolations: number;
  targetViolations: number;
};

export type RehearsalConfig = {
  sourceUrl: string;
  targetUrl: string;
  reportPath?: string;
  targetLabel: string;
};

export const modelDefinitions = SqlitePrisma.dmmf.datamodel.models;

export function parseRehearsalConfig(argv: string[]): RehearsalConfig {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]!;
    if (!item.startsWith("--")) throw new Error(`Неизвестный аргумент: ${item}`);
    if (item === "--confirm-local-rehearsal") {
      flags.add(item);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Для ${item} требуется значение`);
    values.set(item, value);
    index += 1;
  }

  const sourceUrl = values.get("--source");
  const targetUrl = values.get("--target");
  if (!sourceUrl || !targetUrl) {
    throw new Error("Укажите оба URL явно: --source file:/absolute/source.db --target postgresql://.../zabota_rehearsal");
  }
  if (!flags.has("--confirm-local-rehearsal")) {
    throw new Error("Добавьте --confirm-local-rehearsal после проверки source и target URL");
  }
  assertSafeSqliteSource(sourceUrl);
  const targetLabel = assertSafePostgresTarget(targetUrl);
  return { sourceUrl, targetUrl, reportPath: values.get("--report"), targetLabel };
}

export function createClients(config: RehearsalConfig) {
  return {
    source: new SqlitePrismaClient({ datasourceUrl: config.sourceUrl }) as unknown as RuntimeClient,
    target: new PostgresPrismaClient({ datasourceUrl: config.targetUrl }) as unknown as RuntimeClient
  };
}

export function delegateName(modelName: string) {
  return `${modelName[0]!.toLowerCase()}${modelName.slice(1)}`;
}

export function scalarFieldNames(model: ModelDefinition) {
  return model.fields.filter((field) => field.kind !== "object").map((field) => field.name);
}

export function projectScalarData(row: Record<string, unknown>, model: ModelDefinition) {
  return Object.fromEntries(scalarFieldNames(model).map((field) => [field, row[field]]));
}

export async function assertTargetIsEmpty(target: RuntimeClient) {
  const occupied: Array<{ model: string; count: number }> = [];
  for (const model of modelDefinitions) {
    const count = await target[delegateName(model.name)].count();
    if (count > 0) occupied.push({ model: model.name, count });
  }
  if (occupied.length > 0) {
    throw new Error(`Target PostgreSQL должен быть чистым: ${occupied.map((item) => `${item.model}=${item.count}`).join(", ")}`);
  }
}

export async function buildVerificationReport(source: RuntimeClient, target: RuntimeClient, targetLabel: string) {
  const sourceRows = new Map<string, Record<string, unknown>[]>();
  const targetRows = new Map<string, Record<string, unknown>[]>();
  const models: Record<string, unknown> = {};
  const failures: string[] = [];

  for (const model of modelDefinitions) {
    const select = Object.fromEntries(scalarFieldNames(model).map((field) => [field, true]));
    const [left, right] = await Promise.all([
      source[delegateName(model.name)].findMany({ select }),
      target[delegateName(model.name)].findMany({ select })
    ]);
    sourceRows.set(model.name, left);
    targetRows.set(model.name, right);

    const primaryFields = model.fields.filter((field) => field.isId).map((field) => field.name);
    const sourceIds = sortedSignatures(left, primaryFields);
    const targetIds = sortedSignatures(right, primaryFields);
    const nullableFields = model.fields.filter((field) => field.kind !== "object" && !field.isRequired).map((field) => field.name);
    const nullConsistency = nullableFields.map((field) => ({
      field,
      source: left.filter((row: Record<string, unknown>) => row[field] === null).length,
      target: right.filter((row: Record<string, unknown>) => row[field] === null).length
    }));
    const uniqueSets = uniqueFieldSets(model).map((fields) => ({
      fields,
      sourceDuplicates: duplicateSignatures(left, fields),
      targetDuplicates: duplicateSignatures(right, fields)
    }));
    const sourceDigest = rowsDigest(left, scalarFieldNames(model), primaryFields);
    const targetDigest = rowsDigest(right, scalarFieldNames(model), primaryFields);
    const modelFailures: string[] = [];
    if (left.length !== right.length) modelFailures.push("count");
    if (JSON.stringify(sourceIds) !== JSON.stringify(targetIds)) modelFailures.push("primary_ids");
    if (sourceDigest !== targetDigest) modelFailures.push("scalar_digest");
    if (nullConsistency.some((item) => item.source !== item.target)) modelFailures.push("null_consistency");
    if (uniqueSets.some((item) => item.sourceDuplicates.length > 0 || item.targetDuplicates.length > 0)) modelFailures.push("unique_constraints");
    if (modelFailures.length > 0) failures.push(`${model.name}: ${modelFailures.join(", ")}`);
    models[model.name] = {
      sourceCount: left.length,
      targetCount: right.length,
      primaryIdsMatch: JSON.stringify(sourceIds) === JSON.stringify(targetIds),
      scalarDigest: { source: sourceDigest, target: targetDigest, match: sourceDigest === targetDigest },
      nullConsistency,
      uniqueSets
    };
  }

  const foreignKeys = verifyForeignKeys(sourceRows, targetRows);
  for (const item of foreignKeys) {
    if (item.sourceViolations > 0 || item.targetViolations > 0) {
      failures.push(`${item.model}.${item.fields.join("+")}: foreign_key_completeness`);
    }
  }

  const critical = {
    finance: financeReport(sourceRows, targetRows),
    legal: criticalModelReport(sourceRows, targetRows, ["LegalDocument", "UserConsent", "UserConsentAuditLog", "Consent", "AuditLog"]),
    requests: criticalModelReport(sourceRows, targetRows, ["ClientRequest", "RequestCategorySnapshot", "RequestResponse", "Chat", "AgreementVersion", "AgreementContract", "RequestVisit", "RequestVisitDispute"]),
    files: criticalModelReport(sourceRows, targetRows, ["PerformerDocument", "ServiceMessageAttachment"])
  };
  if (!critical.finance.match) failures.push("critical.finance: aggregate_mismatch");
  for (const [groupName, group] of Object.entries({ legal: critical.legal, requests: critical.requests, files: critical.files })) {
    for (const [modelName, result] of Object.entries(group)) {
      if (!result.match) failures.push(`critical.${groupName}.${modelName}: mismatch`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    target: targetLabel,
    passed: failures.length === 0,
    failures,
    summary: {
      models: modelDefinitions.length,
      sourceRows: Array.from(sourceRows.values()).reduce((sum, rows) => sum + rows.length, 0),
      targetRows: Array.from(targetRows.values()).reduce((sum, rows) => sum + rows.length, 0)
    },
    models,
    foreignKeys,
    critical
  };
  return report;
}

export function writeVerificationReport(report: unknown, reportPath?: string) {
  if (!reportPath) return;
  const absolutePath = path.resolve(reportPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function assertSafeSqliteSource(sourceUrl: string) {
  if (!sourceUrl.startsWith("file:")) throw new Error("Source должен быть явным SQLite file: URL");
  const sourcePath = decodeURIComponent(sourceUrl.slice("file:".length).split("?")[0]!);
  if (!path.isAbsolute(sourcePath)) throw new Error("Source SQLite URL должен содержать абсолютный путь");
  if (!existsSync(sourcePath)) throw new Error(`Source SQLite файл не найден: ${sourcePath}`);
}

function assertSafePostgresTarget(targetUrl: string) {
  const parsed = new URL(targetUrl);
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) throw new Error("Target должен быть PostgreSQL URL");
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
    throw new Error("Target отклонён: rehearsal разрешён только для loopback PostgreSQL");
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!/(rehearsal|test|smoke)/i.test(database)) {
    throw new Error("Target database должна содержать rehearsal, test или smoke в имени");
  }
  if (!parsed.username || !parsed.password) throw new Error("Target URL должен содержать отдельные local/test credentials");
  return `${parsed.hostname}:${parsed.port || "5432"}/${database}`;
}

function normalizedValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  return value;
}

function signature(row: Record<string, unknown>, fields: readonly string[]) {
  return JSON.stringify(fields.map((field) => normalizedValue(row[field])));
}

function sortedSignatures(rows: Record<string, unknown>[], fields: readonly string[]) {
  return rows.map((row) => signature(row, fields)).sort();
}

function rowsDigest(rows: Record<string, unknown>[], fields: readonly string[], primaryFields: readonly string[]) {
  const normalized = [...rows]
    .sort((left, right) => signature(left, primaryFields).localeCompare(signature(right, primaryFields)))
    .map((row) => fields.map((field) => normalizedValue(row[field])));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function uniqueFieldSets(model: ModelDefinition) {
  const single = model.fields.filter((field) => field.isUnique).map((field) => [field.name]);
  return [...single, ...model.uniqueFields];
}

function duplicateSignatures(rows: Record<string, unknown>[], fields: readonly string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (fields.some((field) => row[field] === null)) continue;
    const value = signature(row, fields);
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function verifyForeignKeys(
  sourceRows: Map<string, Record<string, unknown>[]>,
  targetRows: Map<string, Record<string, unknown>[]>
): ForeignKeyReport[] {
  const checks: ForeignKeyReport[] = [];
  for (const model of modelDefinitions) {
    for (const relation of model.fields.filter((field) => field.kind === "object" && field.relationFromFields?.length)) {
      const fields = relation.relationFromFields!;
      const references = relation.relationToFields!;
      const parentModel = relation.type;
      const sourceParentKeys = new Set(sortedSignatures(sourceRows.get(parentModel) ?? [], references));
      const targetParentKeys = new Set(sortedSignatures(targetRows.get(parentModel) ?? [], references));
      const countViolations = (rows: Record<string, unknown>[], parentKeys: Set<string>) => rows.filter((row) => {
        const values = fields.map((field) => row[field]);
        if (values.every((value) => value === null)) return false;
        if (values.some((value) => value === null)) return true;
        return !parentKeys.has(signature(row, fields));
      }).length;
      checks.push({
        model: model.name,
        fields,
        references: `${parentModel}.${references.join("+")}`,
        sourceViolations: countViolations(sourceRows.get(model.name) ?? [], sourceParentKeys),
        targetViolations: countViolations(targetRows.get(model.name) ?? [], targetParentKeys)
      });
    }
  }
  return checks;
}

function criticalModelReport(
  sourceRows: Map<string, Record<string, unknown>[]>,
  targetRows: Map<string, Record<string, unknown>[]>,
  modelNames: string[]
) {
  return Object.fromEntries(modelNames.map((modelName) => {
    const model = modelDefinitions.find((item) => item.name === modelName)!;
    const fields = scalarFieldNames(model);
    const primaryFields = model.fields.filter((field) => field.isId).map((field) => field.name);
    const left = sourceRows.get(modelName) ?? [];
    const right = targetRows.get(modelName) ?? [];
    const sourceDigest = rowsDigest(left, fields, primaryFields);
    const targetDigest = rowsDigest(right, fields, primaryFields);
    return [modelName, {
      sourceCount: left.length,
      targetCount: right.length,
      sourceDigest,
      targetDigest,
      match: left.length === right.length && sourceDigest === targetDigest
    }];
  }));
}

function financeReport(
  sourceRows: Map<string, Record<string, unknown>[]>,
  targetRows: Map<string, Record<string, unknown>[]>
) {
  const summarize = (rows: Map<string, Record<string, unknown>[]>) => {
    const users = rows.get("User") ?? [];
    const ledger = rows.get("BalanceTransaction") ?? [];
    const balances = Object.fromEntries([...users]
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .map((user) => [String(user.id), {
      balance: user.balance,
      bonusBalance: user.bonusBalance
    }]));
    const ledgerByUserAndType: Record<string, number> = {};
    for (const entry of ledger) {
      const key = `${entry.userId}|${entry.type}|${entry.balanceKind}`;
      ledgerByUserAndType[key] = (ledgerByUserAndType[key] ?? 0) + Number(entry.amount);
    }
    const sortedLedger = Object.fromEntries(Object.entries(ledgerByUserAndType).sort(([left], [right]) => left.localeCompare(right)));
    return {
      balances,
      ledgerByUserAndType: sortedLedger,
      idempotencyKeys: ledger.map((entry) => entry.idempotencyKey).filter(Boolean).sort(),
      counts: Object.fromEntries([
        "BalanceTransaction",
        "PaymentTransaction",
        "RefundTransaction",
        "NpdTaxRegisterEntry",
        "ServiceFeeAgreementBatch",
        "ServiceFeeVisitAllocation"
      ].map((model) => [model, (rows.get(model) ?? []).length]))
    };
  };
  const source = summarize(sourceRows);
  const target = summarize(targetRows);
  return { source, target, match: JSON.stringify(source) === JSON.stringify(target) };
}

export type { RuntimeClient };
export { PostgresPrisma };
