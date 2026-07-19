export function FilterPanel({
  title = "Фильтры",
  activeCount,
  onReset,
  children
}: {
  title?: string;
  activeCount?: number;
  onReset?: () => void;
  children: React.ReactNode;
}) {
  return (
    <details className="filter-panel" open>
      <summary>
        <span>{title}</span>
        {typeof activeCount === "number" && activeCount > 0 && <strong>{activeCount}</strong>}
      </summary>
      <div className="filter-panel__body">
        {children}
        {onReset && (
          <button className="secondary-button" type="button" onClick={onReset}>
            Сбросить
          </button>
        )}
      </div>
    </details>
  );
}
