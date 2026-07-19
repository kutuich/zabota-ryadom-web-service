import type { PaymentTransaction, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";

type Tx = Prisma.TransactionClient;

export type PaymentCreditResult = {
  payment: PaymentTransaction;
  balanceTransaction: Awaited<ReturnType<Tx["balanceTransaction"]["create"]>> | null;
  credited: boolean;
};

export async function creditPaymentToBalanceTx(
  tx: Tx,
  payment: Pick<PaymentTransaction, "id">,
  options: {
    reason?: string;
    comment?: string;
  } = {}
): Promise<PaymentCreditResult> {
  const current = await tx.paymentTransaction.findUnique({
    where: { id: payment.id }
  });
  if (!current) {
    throw new HttpError(404, "Платёж не найден", "payment_not_found");
  }

  if (current.creditedAt || current.balanceTransactionId) {
    return {
      payment: current,
      balanceTransaction: current.balanceTransactionId
        ? await tx.balanceTransaction.findUnique({ where: { id: current.balanceTransactionId } })
        : null,
      credited: false
    };
  }

  const user = await tx.user.findUnique({
    where: { id: current.userId },
    select: { balance: true }
  });
  if (!user) {
    throw new HttpError(404, "Пользователь платежа не найден", "payment_user_not_found");
  }

  const balanceBefore = user.balance;
  const balanceAfter = balanceBefore + current.amount;

  await tx.user.update({
    where: { id: current.userId },
    data: { balance: { increment: current.amount } }
  });

  const balanceTransaction = await tx.balanceTransaction.create({
    data: {
      userId: current.userId,
      type: "top_up",
      amount: current.amount,
      balanceKind: "real",
      reason: options.reason ?? "Пополнение баланса через платёжную форму",
      comment: options.comment ?? current.orderId,
      balanceBefore,
      balanceAfter
    }
  });

  const now = new Date();
  const updated = await tx.paymentTransaction.update({
    where: { id: current.id },
    data: {
      status: "succeeded",
      paidAt: current.paidAt ?? now,
      creditedAt: now,
      balanceTransactionId: balanceTransaction.id
    }
  });

  return { payment: updated, balanceTransaction, credited: true };
}

export async function getPaymentBalanceSummary(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { balance: true, bonusBalance: true }
  });
  if (!user) {
    throw new HttpError(404, "Пользователь не найден", "user_not_found");
  }

  return {
    realBalance: user.balance,
    bonusBalance: user.bonusBalance,
    totalAvailableBalance: user.balance + user.bonusBalance
  };
}
