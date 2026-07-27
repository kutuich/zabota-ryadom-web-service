type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function StatusBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

export function statusTone(status: string): Tone {
  if (["active", "open", "in_work", "in_progress", "completed", "accepted_by_client", "trusted_by_reviews", "approved", "verified"].includes(status)) {
    return "success";
  }
  if (["blocked", "hidden", "rejected", "rejected_by_client", "missing_criminal_record", "waiting_client_balance", "waiting_performer_balance"].includes(status)) {
    return "danger";
  }
  if (["new", "pending", "pending_archive", "waiting_for_responses", "has_responses", "flagged", "in_review", "waiting_client_confirmation", "waiting_performer_confirmation", "new_terms_proposed"].includes(status)) {
    return "warning";
  }
  if (["discussion", "chat_opened", "performer_selected", "published"].includes(status)) {
    return "info";
  }
  return "neutral";
}
