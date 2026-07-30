import { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { api } from "../api/client";

type Summary = {
  charged: number;
  mainFunded: number;
  bonusFunded: number;
  reserved: number;
  disputed: number;
  released: number;
  refunded: number;
  compensated: number;
  moneyReserve: number;
  bonusObligations: number;
  operationalRisk: number;
  reconciliation?: {
    enabled: boolean;
    running: boolean;
    intervalMinutes: number;
    lastSuccessfulAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
    lastChecked: number;
    lastClosed: number;
    nextRunAt: string | null;
  };
};

export function VisitReservePanel({ canReconcile }: { canReconcile: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [notice, setNotice] = useState("");
  const load = async () => setSummary(await api.visitReserveSummary());
  useEffect(() => { void load().catch((error) => setNotice(error.message)); }, []);
  return (
    <section className="plain-section stack">
      <div className="card__head">
        <div><p className="eyebrow">Внутренний учёт</p><h2>Резерв возможных возвратов по визитам</h2></div>
        {canReconcile && <button className="secondary-button" type="button" onClick={async () => { const result = await api.reconcileVisits(); setNotice(`Проверено: ${result.checked}, закрыто: ${result.closed}.`); await load(); }}><RefreshCcw size={18} />Сверить визиты</button>}
      </div>
      <p>Это аналитический показатель. Он не меняет пользовательский баланс и не блокирует деньги в банке.</p>
      {summary && <div className="stats-grid">
        <Metric label="Списано" value={summary.charged} />
        <Metric label="Источник: основной баланс" value={summary.mainFunded} />
        <Metric label="Источник: бонусный баланс" value={summary.bonusFunded} />
        <Metric label="Денежный резерв" value={summary.moneyReserve} />
        <Metric label="Бонусные обязательства" value={summary.bonusObligations} />
        <Metric label="Общий операционный риск" value={summary.operationalRisk} />
        <Metric label="Освобождено" value={summary.released} />
        <Metric label="В споре" value={summary.disputed} />
        <Metric label="Возвращено" value={summary.refunded} />
      </div>}
      {summary?.reconciliation && <div className="details-box detail-grid reconciliation-status">
        <span>Автоматическая сверка</span><strong>{summary.reconciliation.enabled ? "Включена" : "Выключена"}</strong>
        <span>Последнее успешное выполнение</span><strong>{formatDateTime(summary.reconciliation.lastSuccessfulAt)}</strong>
        <span>Последняя ошибка</span><strong>{summary.reconciliation.lastError || "Нет"}</strong>
        <span>Обработано в последнем запуске</span><strong>{summary.reconciliation.lastChecked}, закрыто {summary.reconciliation.lastClosed}</strong>
        <span>Ближайшее выполнение</span><strong>{formatDateTime(summary.reconciliation.nextRunAt)}</strong>
      </div>}
      {notice && <p className="notice">{notice}</p>}
    </section>
  );
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("ru-RU") : "Нет данных";
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className="stat-card"><span>{label}</span><strong>{value.toLocaleString("ru-RU")} ₽</strong></article>;
}
