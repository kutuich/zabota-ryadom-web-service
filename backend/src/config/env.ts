import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env"), override: false });

export function resolveDefaultServiceFeeAmount(source: NodeJS.ProcessEnv = process.env) {
  return Number(source.DEFAULT_SERVICE_FEE_AMOUNT ?? 50);
}

export function resolveUploadsDir(source: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  const configured = source.UPLOADS_DIR?.trim();
  if (configured) return path.resolve(configured);
  return source.NODE_ENV === "production"
    ? "/data/uploads"
    : path.resolve(path.basename(cwd) === "backend" ? cwd : path.join(cwd, "backend"), "uploads");
}

export function resolveTbankTerminalMode(source: NodeJS.ProcessEnv = process.env): "test" | "live" {
  return source.TBANK_TERMINAL_MODE === "live" ? "live" : "test";
}

const defaultServiceFeeAmount = resolveDefaultServiceFeeAmount();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  jwtSecret: process.env.JWT_SECRET ?? "local-development-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  uploadsDir: resolveUploadsDir(),
  yandexMapsApiKey: process.env.YANDEX_MAPS_API_KEY ?? "",
  defaultServiceFeeAmount,
  // Deprecated API compatibility alias. DEFAULT_COMMISSION_AMOUNT no longer controls business logic.
  defaultCommissionAmount: defaultServiceFeeAmount,
  defaultMinTopUpAmount: Number(process.env.DEFAULT_MIN_TOP_UP_AMOUNT ?? 150),
  trialBalanceEnabled: process.env.TRIAL_BALANCE_ENABLED === "true",
  trialBalanceAmount: Number(process.env.TRIAL_BALANCE_AMOUNT ?? 100),
  paymentProvider: process.env.PAYMENT_PROVIDER ?? "mock",
  paymentReceiptEnabled: process.env.PAYMENT_RECEIPT_ENABLED === "true",
  allowLegacyMockTopUp: process.env.ALLOW_LEGACY_MOCK_TOP_UP === "true",
  tbankTerminalKey: process.env.TBANK_TERMINAL_KEY ?? "",
  tbankTerminalMode: resolveTbankTerminalMode(),
  tbankPassword: process.env.TBANK_PASSWORD ?? "",
  tbankApiUrl: process.env.TBANK_API_URL ?? "https://securepay.tinkoff.ru/v2",
  tbankSuccessUrl: process.env.TBANK_SUCCESS_URL ?? "http://localhost:4000/app/balance/payment-success",
  tbankFailUrl: process.env.TBANK_FAIL_URL ?? "http://localhost:4000/app/balance/payment-fail",
  tbankNotificationUrl: process.env.TBANK_NOTIFICATION_URL ?? "http://localhost:4000/api/payments/tbank/webhook",
  oauthEnabled: process.env.OAUTH_ENABLED === "true",
  vkIdEnabled: process.env.VK_ID_ENABLED === "true",
  vkIdClientId: process.env.VK_ID_CLIENT_ID ?? "",
  vkIdClientSecret: process.env.VK_ID_CLIENT_SECRET ?? "",
  vkIdRedirectUri: process.env.VK_ID_REDIRECT_URI ?? "http://localhost:4000/api/auth/oauth/vk/callback",
  vkIdSuccessRedirectPath: process.env.VK_ID_SUCCESS_REDIRECT_PATH ?? "/app/oauth/complete",
  vkIdFailRedirectPath: process.env.VK_ID_FAIL_REDIRECT_PATH ?? "/app/login?oauthError=vk"
};

if (env.nodeEnv === "production" && env.jwtSecret.includes("change-me")) {
  throw new Error("JWT_SECRET must be set to a strong value in production.");
}
