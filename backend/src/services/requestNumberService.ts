import type { Prisma } from "@prisma/client";

export async function nextRequestPublicNumber(tx: Prisma.TransactionClient) {
  const year = new Date().getFullYear();
  const prefix = `ZR-${year}-`;
  const rows = await tx.clientRequest.findMany({
    where: { publicNumber: { startsWith: prefix } },
    select: { publicNumber: true }
  });
  const maxNumber = rows.reduce((max, row) => {
    const number = Number(row.publicNumber?.slice(prefix.length));
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 0);
  return `${prefix}${String(maxNumber + 1).padStart(4, "0")}`;
}
