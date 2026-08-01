import { HttpError } from "./http";

export type SemanticVersion = { major: number; minor: number; patch: number | null };

const SEMVER_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/i;

export function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = value.trim().match(SEMVER_PATTERN);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: match[3] == null ? null : Number(match[3]) };
}

export function normalizeSemanticVersion(value: string) {
  const parsed = parseSemanticVersion(value);
  if (!parsed) throw new HttpError(400, "Версия должна иметь формат v2.0 или v2.0.1", "category_structure_version_invalid");
  return `${parsed.major}.${parsed.minor}${parsed.patch == null ? "" : `.${parsed.patch}`}`;
}

export function compareSemanticVersions(left: string, right: string) {
  const a = parseSemanticVersion(left);
  const b = parseSemanticVersion(right);
  if (!a || !b) return left.localeCompare(right, "ru", { numeric: true });
  return a.major - b.major || a.minor - b.minor || (a.patch ?? 0) - (b.patch ?? 0) || Number(a.patch != null) - Number(b.patch != null);
}

export function bumpSemanticVersion(value: string, kind: "minor" | "patch") {
  const parsed = parseSemanticVersion(value);
  if (!parsed) return kind === "patch" ? "1.0.1" : "1.1";
  if (kind === "patch") return `${parsed.major}.${parsed.minor}.${(parsed.patch ?? 0) + 1}`;
  return `${parsed.major}.${parsed.minor + 1}`;
}
