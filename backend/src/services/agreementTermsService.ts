export type AgreementTermsSource = {
  agreedHelperAmount?: number | null;
  customerServiceFeeAmount?: number | null;
  helperServiceFeeAmount?: number | null;
  customerTotalAmount?: number | null;
  helperNetAmount?: number | null;
  agreedPackageId?: string | null;
  agreedPackageTitle?: string | null;
  agreedAddonsJson?: string | null;
  agreedDurationMinutes?: number | null;
  agreedScheduledAt?: Date | string | null;
  agreedTermsComment?: string | null;
  agreedByCustomerAt?: Date | string | null;
  agreedByHelperAt?: Date | string | null;
  termsUpdatedAt?: Date | string | null;
  termsUpdatedByUserId?: string | null;
};

export function serializeAgreedTerms(source?: AgreementTermsSource | null) {
  if (!source?.agreedHelperAmount) return null;
  return {
    agreedHelperAmount: source.agreedHelperAmount,
    customerServiceFeeAmount: source.customerServiceFeeAmount ?? 50,
    helperServiceFeeAmount: source.helperServiceFeeAmount ?? 50,
    customerTotalAmount: source.customerTotalAmount ?? source.agreedHelperAmount + 50,
    helperNetAmount: source.helperNetAmount ?? Math.max(0, source.agreedHelperAmount - 50),
    agreedPackageId: source.agreedPackageId ?? null,
    agreedPackageTitle: source.agreedPackageTitle ?? null,
    agreedAddons: parseStringArray(source.agreedAddonsJson),
    agreedDurationMinutes: source.agreedDurationMinutes ?? null,
    agreedScheduledAt: source.agreedScheduledAt ?? null,
    agreedTermsComment: source.agreedTermsComment ?? null,
    agreedByCustomerAt: source.agreedByCustomerAt ?? null,
    agreedByHelperAt: source.agreedByHelperAt ?? null,
    termsUpdatedAt: source.termsUpdatedAt ?? null,
    termsUpdatedByUserId: source.termsUpdatedByUserId ?? null
  };
}

function parseStringArray(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
