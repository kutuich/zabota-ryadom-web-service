const REDACTED = "[REDACTED]";

const sensitiveKeyPattern = /(?:pass(?:word|hash)?|token|authorization|cookie|secret|credential|dsn|api[-_]?key|access[-_]?key|private[-_]?key|card|pan|cvv|bank|account|phone|email|address|body|file(?:data|content)?)/i;

const stringPatterns: Array<[RegExp, string]> = [
  [/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED],
  [/(?:\+7|\b8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}\b/g, REDACTED],
  [/\b(postgresql|postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/gi, "$1://[REDACTED]@"],
  [/([?&](?:token|code|secret|password|signature|key)=)[^&#\s]*/gi, `$1${REDACTED}`],
  [/(\b(?:password|token|secret|authorization|cookie|dsn|api[-_]?key|access[-_]?key)=)[^&\s,;]+/gi, `$1${REDACTED}`]
];

export function isSensitiveLogKey(key: string) {
  return sensitiveKeyPattern.test(key);
}

export function redactString(value: string) {
  return stringPatterns.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}

export function redactSensitive<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[BINARY:${value.byteLength}]`;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, seen));

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = isSensitiveLogKey(key) ? REDACTED : redactValue(entry, seen);
  }
  return result;
}

export function safeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: redactString(error.name).slice(0, 120),
      message: redactString(error.message).slice(0, 1000)
    };
  }
  return { name: "UnknownError", message: redactString(String(error)).slice(0, 1000) };
}
