export function EmptyState({
  title,
  action
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="empty-state">
      <strong>{title}</strong>
      {action}
    </section>
  );
}
