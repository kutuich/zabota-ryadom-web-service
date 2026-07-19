import { env } from "../config/env";
import { buildTbankToken } from "./tbankToken";

export const PAYMENT_STATUSES = [
  "created",
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "refunded",
  "manual_review"
] as const;

export type PaymentProvider = "mock" | "tbank";
export type PaymentStatus = typeof PAYMENT_STATUSES[number];

export type PaymentResult = {
  provider: "mock";
  providerPaymentId: string;
  status: "succeeded";
  amount: number;
};

export type CreateTopUpPaymentInput = {
  userId: string;
  amount: number;
  orderId: string;
  description?: string;
  successUrl?: string;
  failUrl?: string;
  notificationUrl?: string;
  metadata?: Record<string, unknown>;
};

export type CreateTopUpPaymentResult = {
  provider: PaymentProvider;
  providerPaymentId: string | null;
  paymentUrl: string | null;
  status: PaymentStatus;
  rawRequestJson: string | null;
  rawResponseJson: string | null;
};

export class PaymentInitError extends Error {
  provider: PaymentProvider;
  providerPaymentId: string | null;
  rawRequestJson: string | null;
  rawResponseJson: string | null;
  status: PaymentStatus;

  constructor(message: string, options: {
    provider: PaymentProvider;
    providerPaymentId?: string | null;
    rawRequestJson?: string | null;
    rawResponseJson?: string | null;
    status?: PaymentStatus;
  }) {
    super(message);
    this.provider = options.provider;
    this.providerPaymentId = options.providerPaymentId ?? null;
    this.rawRequestJson = options.rawRequestJson ?? null;
    this.rawResponseJson = options.rawResponseJson ?? null;
    this.status = options.status ?? "failed";
  }
}

export interface PaymentAdapter {
  createTopUpPayment(input: CreateTopUpPaymentInput): Promise<CreateTopUpPaymentResult>;
  createTopUp(amount: number, userId: string): Promise<PaymentResult>;
}

export const mockPaymentAdapter: PaymentAdapter = {
  async createTopUpPayment(input) {
    const providerPaymentId = `MOCK-${input.orderId}`;
    const paymentUrl = `/app/balance/mock-payment?orderId=${encodeURIComponent(input.orderId)}`;
    const response = {
      provider: "mock",
      providerPaymentId,
      paymentUrl,
      status: "pending"
    };

    return {
      provider: "mock",
      providerPaymentId,
      paymentUrl,
      status: "pending",
      rawRequestJson: JSON.stringify(input),
      rawResponseJson: JSON.stringify(response)
    };
  },
  async createTopUp(amount, userId) {
    return {
      provider: "mock",
      providerPaymentId: `mock-${userId}-${Date.now()}`,
      status: "succeeded",
      amount
    };
  }
};

export const tbankPaymentAdapter: PaymentAdapter = {
  async createTopUpPayment(input) {
    if (!env.tbankTerminalKey || !env.tbankPassword || !env.tbankApiUrl || !env.tbankSuccessUrl || !env.tbankFailUrl || !env.tbankNotificationUrl) {
      throw new Error("Платёжный провайдер не настроен");
    }

    const initRequest = {
      TerminalKey: env.tbankTerminalKey,
      Amount: input.amount * 100,
      OrderId: input.orderId,
      Description: "Пополнение баланса Забота Рядом",
      SuccessURL: input.successUrl || env.tbankSuccessUrl,
      FailURL: input.failUrl || env.tbankFailUrl,
      NotificationURL: input.notificationUrl || env.tbankNotificationUrl,
      DATA: {
        userId: input.userId,
        purpose: "balance_top_up"
      }
    };
    const initRequestWithToken = {
      ...initRequest,
      Token: buildTbankToken(initRequest, env.tbankPassword)
      // TODO: add Receipt when fiscalization is enabled.
    };
    const rawRequestJson = JSON.stringify(initRequestWithToken);
    const response = await fetch(`${env.tbankApiUrl.replace(/\/$/, "")}/Init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawRequestJson
    });
    const responsePayload = await response.json().catch(async () => ({ Message: await response.text().catch(() => "") })) as Record<string, unknown>;
    const rawResponseJson = JSON.stringify(responsePayload);

    if (!response.ok || responsePayload.Success === false) {
      throw new PaymentInitError(tbankErrorMessage(responsePayload, response.status), {
        provider: "tbank",
        providerPaymentId: responsePayload.PaymentId === undefined || responsePayload.PaymentId === null ? null : String(responsePayload.PaymentId),
        rawRequestJson,
        rawResponseJson,
        status: "failed"
      });
    }

    const paymentUrl = valueAsString(responsePayload.PaymentURL ?? responsePayload.PaymentUrl);
    if (!paymentUrl) {
      throw new Error("Платёжный провайдер не вернул ссылку на платёжную форму");
    }

    return {
      provider: "tbank",
      providerPaymentId: responsePayload.PaymentId === undefined || responsePayload.PaymentId === null ? null : String(responsePayload.PaymentId),
      paymentUrl,
      status: "pending",
      rawRequestJson,
      rawResponseJson
    };
  },
  async createTopUp() {
    throw new Error("Старый mock top-up доступен только для mock provider");
  }
};

export function getPaymentAdapter(provider = env.paymentProvider): PaymentAdapter {
  if (provider === "mock") return mockPaymentAdapter;
  if (provider === "tbank") return tbankPaymentAdapter;
  throw new Error(`Платёжный провайдер ${provider} не поддерживается`);
}

export async function createTopUpPayment(input: CreateTopUpPaymentInput) {
  return getPaymentAdapter().createTopUpPayment(input);
}

function valueAsString(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function tbankErrorMessage(payload: Record<string, unknown>, httpStatus: number) {
  const message = valueAsString(payload.Message);
  const details = valueAsString(payload.Details);
  const errorCode = valueAsString(payload.ErrorCode);
  const parts = [message || "Платёжный провайдер отклонил Init-запрос", details, errorCode ? `код ${errorCode}` : ""].filter(Boolean);
  return httpStatus >= 400 ? `${parts.join(". ")}. HTTP ${httpStatus}` : parts.join(". ");
}
