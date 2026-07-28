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

export type GetPaymentStateInput = {
  providerPaymentId: string | null;
  orderId: string;
  amount: number;
};

export type GetPaymentStateResult = {
  providerPaymentId: string;
  orderId: string | null;
  amountKopecks: number | null;
  providerStatus: string;
  success: true;
  rawResponseJson: string;
};

export type RefundPaymentInput = {
  providerPaymentId: string;
  orderId: string;
  amount: number;
  externalRequestId: string;
};

export type RefundPaymentResult = {
  provider: PaymentProvider;
  providerRefundId: string;
  providerStatus: string;
  rawRequestJson: string;
  rawResponseJson: string;
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

export class PaymentStateError extends Error {
  rawResponseJson: string | null;
  requiresManualReview: boolean;
  reasonCode: string;

  constructor(message: string, options: {
    rawResponseJson?: string | null;
    requiresManualReview?: boolean;
    reasonCode: string;
  }) {
    super(message);
    this.rawResponseJson = options.rawResponseJson ?? null;
    this.requiresManualReview = options.requiresManualReview ?? false;
    this.reasonCode = options.reasonCode;
  }
}

export class PaymentRefundError extends Error {
  rawRequestJson: string | null;
  rawResponseJson: string | null;
  requiresManualReview: boolean;
  reasonCode: string;

  constructor(message: string, options: {
    rawRequestJson?: string | null;
    rawResponseJson?: string | null;
    requiresManualReview?: boolean;
    reasonCode: string;
  }) {
    super(message);
    this.rawRequestJson = options.rawRequestJson ?? null;
    this.rawResponseJson = options.rawResponseJson ?? null;
    this.requiresManualReview = options.requiresManualReview ?? false;
    this.reasonCode = options.reasonCode;
  }
}

export interface PaymentAdapter {
  createTopUpPayment(input: CreateTopUpPaymentInput): Promise<CreateTopUpPaymentResult>;
  createTopUp(amount: number, userId: string): Promise<PaymentResult>;
  getState?(payment: GetPaymentStateInput): Promise<GetPaymentStateResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
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
  },
  async refundPayment(input) {
    const response = {
      Success: true,
      Status: "REFUNDED",
      PaymentId: input.providerPaymentId,
      RefundId: `MOCK-REFUND-${input.externalRequestId}`,
      Amount: input.amount * 100
    };
    return {
      provider: "mock",
      providerRefundId: response.RefundId,
      providerStatus: response.Status,
      rawRequestJson: JSON.stringify(input),
      rawResponseJson: JSON.stringify(response)
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
      PayType: "O",
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
    let response: Response;
    try {
      response = await fetch(`${env.tbankApiUrl.replace(/\/$/, "")}/Init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawRequestJson,
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new PaymentInitError("Платёжный провайдер временно недоступен", {
        provider: "tbank",
        rawRequestJson,
        status: "failed"
      });
    }
    const responsePayload = await response.json().catch(async () => ({ Message: await response.text().catch(() => "") })) as Record<string, unknown>;
    const rawResponseJson = JSON.stringify(responsePayload);

    if (!response.ok || !isProviderSuccess(responsePayload.Success)) {
      throw new PaymentInitError(tbankErrorMessage(responsePayload, response.status), {
        provider: "tbank",
        providerPaymentId: responsePayload.PaymentId === undefined || responsePayload.PaymentId === null ? null : String(responsePayload.PaymentId),
        rawRequestJson,
        rawResponseJson,
        status: "failed"
      });
    }

    const providerPaymentId = valueAsString(responsePayload.PaymentId);
    const responseOrderId = valueAsString(responsePayload.OrderId);
    const responseAmount = responsePayload.Amount === undefined ? input.amount * 100 : Number(responsePayload.Amount);
    const paymentUrl = valueAsString(responsePayload.PaymentURL ?? responsePayload.PaymentUrl);
    if (!providerPaymentId || (responseOrderId && responseOrderId !== input.orderId) || responseAmount !== input.amount * 100 || !isSafePaymentUrl(paymentUrl)) {
      throw new PaymentInitError("Платёжный провайдер вернул некорректный ответ", {
        provider: "tbank",
        providerPaymentId: providerPaymentId || null,
        rawRequestJson,
        rawResponseJson,
        status: "manual_review"
      });
    }

    return {
      provider: "tbank",
      providerPaymentId,
      paymentUrl,
      status: "pending",
      rawRequestJson,
      rawResponseJson
    };
  },
  async getState(payment) {
    if (!env.tbankTerminalKey || !env.tbankPassword || !env.tbankApiUrl) {
      throw new PaymentStateError("Платёжный провайдер не настроен", {
        reasonCode: "provider_not_configured"
      });
    }
    if (!payment.providerPaymentId) {
      throw new PaymentStateError("У платежа нет идентификатора провайдера", {
        requiresManualReview: true,
        reasonCode: "provider_payment_id_missing"
      });
    }

    const stateRequest = {
      TerminalKey: env.tbankTerminalKey,
      PaymentId: payment.providerPaymentId
    };
    const requestBody = JSON.stringify({
      ...stateRequest,
      Token: buildTbankToken(stateRequest, env.tbankPassword)
    });
    let response: Response;
    try {
      response = await fetch(`${env.tbankApiUrl.replace(/\/$/, "")}/GetState`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new PaymentStateError("Платёжный провайдер временно недоступен", {
        reasonCode: "provider_unavailable"
      });
    }

    const responsePayload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const rawResponseJson = JSON.stringify(responsePayload);
    if (!response.ok || !isProviderSuccess(responsePayload.Success)) {
      throw new PaymentStateError("Не удалось получить статус платежа", {
        rawResponseJson,
        reasonCode: "provider_rejected"
      });
    }

    const responseTerminalKey = valueAsString(responsePayload.TerminalKey);
    const responsePaymentId = valueAsString(responsePayload.PaymentId ?? responsePayload.PaymentID);
    const responseOrderId = valueAsString(responsePayload.OrderId ?? responsePayload.OrderID);
    const responseStatus = valueAsString(responsePayload.Status);
    const responseAmount = responsePayload.Amount === undefined || responsePayload.Amount === null
      ? null
      : Number(responsePayload.Amount);
    const identifiersMatch = responsePaymentId === payment.providerPaymentId
      && responseTerminalKey === env.tbankTerminalKey
      && (!responseOrderId || responseOrderId === payment.orderId);
    const amountMatches = responseAmount === null
      || (Number.isSafeInteger(responseAmount) && responseAmount === payment.amount * 100);

    if (!identifiersMatch || !amountMatches || !responseStatus) {
      throw new PaymentStateError("Платёжный провайдер вернул несовпадающие данные", {
        rawResponseJson,
        requiresManualReview: true,
        reasonCode: !identifiersMatch ? "identifier_mismatch" : !amountMatches ? "amount_mismatch" : "status_missing"
      });
    }

    return {
      providerPaymentId: responsePaymentId,
      orderId: responseOrderId || null,
      amountKopecks: responseAmount,
      providerStatus: responseStatus,
      success: true,
      rawResponseJson
    };
  },
  async refundPayment(input) {
    if (!env.tbankTerminalKey || !env.tbankPassword || !env.tbankApiUrl) {
      throw new PaymentRefundError("Платёжный провайдер не настроен", {
        reasonCode: "provider_not_configured"
      });
    }

    const cancelRequest = {
      TerminalKey: env.tbankTerminalKey,
      PaymentId: input.providerPaymentId,
      Amount: input.amount * 100,
      ExternalRequestId: input.externalRequestId
      // TODO: add Receipt only after fiscalization is separately enabled and verified.
    };
    const requestBody = JSON.stringify({
      ...cancelRequest,
      Token: buildTbankToken(cancelRequest, env.tbankPassword)
    });
    let response: Response;
    try {
      response = await fetch(`${env.tbankApiUrl.replace(/\/$/, "")}/Cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new PaymentRefundError("Платёжный провайдер временно недоступен", {
        rawRequestJson: requestBody,
        reasonCode: "provider_unavailable"
      });
    }

    const responsePayload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const rawResponseJson = JSON.stringify(responsePayload);
    if (!response.ok || !isProviderSuccess(responsePayload.Success)) {
      throw new PaymentRefundError("Платёжный провайдер отклонил возврат", {
        rawRequestJson: requestBody,
        rawResponseJson,
        reasonCode: "provider_rejected"
      });
    }

    const responsePaymentId = valueAsString(responsePayload.PaymentId ?? responsePayload.PaymentID);
    const responseTerminalKey = valueAsString(responsePayload.TerminalKey);
    const providerStatus = valueAsString(responsePayload.Status).toUpperCase();
    const providerRefundId = valueAsString(responsePayload.RefundId ?? responsePayload.RefundID ?? responsePayload.PaymentId);
    const expectedAmount = input.amount * 100;
    const amount = responsePayload.Amount === undefined || responsePayload.Amount === null ? expectedAmount : Number(responsePayload.Amount);
    const originalAmount = responsePayload.OriginalAmount === undefined || responsePayload.OriginalAmount === null
      ? expectedAmount
      : Number(responsePayload.OriginalAmount);
    const newAmount = responsePayload.NewAmount === undefined || responsePayload.NewAmount === null
      ? 0
      : Number(responsePayload.NewAmount);
    const validStatus = providerStatus === "REFUNDED";
    const identifiersMatch = responsePaymentId === input.providerPaymentId
      && (!responseTerminalKey || responseTerminalKey === env.tbankTerminalKey);
    const amountsMatch = amount === expectedAmount && originalAmount === expectedAmount && newAmount === 0;
    if (!identifiersMatch || !amountsMatch || !providerRefundId || !validStatus) {
      throw new PaymentRefundError("Платёжный провайдер вернул несовпадающие данные возврата", {
        rawRequestJson: requestBody,
        rawResponseJson,
        requiresManualReview: true,
        reasonCode: !validStatus ? "unexpected_refund_status" : !identifiersMatch ? "refund_identifier_mismatch" : "refund_data_mismatch"
      });
    }

    return {
      provider: "tbank",
      providerRefundId,
      providerStatus,
      rawRequestJson: requestBody,
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

function isProviderSuccess(value: unknown) {
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function isSafePaymentUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (env.nodeEnv !== "production" && url.protocol === "http:");
  } catch {
    return false;
  }
}
