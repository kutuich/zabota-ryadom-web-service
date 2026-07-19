import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env"), override: false });

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  jwtSecret: process.env.JWT_SECRET ?? "local-development-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  yandexMapsApiKey: process.env.YANDEX_MAPS_API_KEY ?? "",
  defaultCommissionAmount: Number(process.env.DEFAULT_COMMISSION_AMOUNT ?? process.env.DEFAULT_SERVICE_FEE_AMOUNT ?? 50),
  defaultMinTopUpAmount: Number(process.env.DEFAULT_MIN_TOP_UP_AMOUNT ?? 150),
  paymentProvider: process.env.PAYMENT_PROVIDER ?? "mock",
  paymentReceiptEnabled: process.env.PAYMENT_RECEIPT_ENABLED === "true",
  tbankTerminalKey: process.env.TBANK_TERMINAL_KEY ?? "",
  tbankPassword: process.env.TBANK_PASSWORD ?? "",
  tbankApiUrl: process.env.TBANK_API_URL ?? "https://securepay.tinkoff.ru/v2",
  tbankSuccessUrl: process.env.TBANK_SUCCESS_URL ?? "http://localhost:4000/app/balance/payment-success",
  tbankFailUrl: process.env.TBANK_FAIL_URL ?? "http://localhost:4000/app/balance/payment-fail",
  tbankNotificationUrl: process.env.TBANK_NOTIFICATION_URL ?? "http://localhost:4000/api/payments/tbank/webhook"
};

if (env.nodeEnv === "production" && env.jwtSecret.includes("change-me")) {
  throw new Error("JWT_SECRET must be set to a strong value in production.");
}
