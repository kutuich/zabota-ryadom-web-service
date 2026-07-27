import type { AgreedTerms } from "../types";
import { formatDateRu, formatTimeRu } from "../utils/dateTime";

const addonLabels: Record<string, string> = {
  extra_hour: "Дополнительный час",
  waiting: "Ожидание",
  second_address: "Второй адрес",
  shopping: "Покупки",
  simple_meal_extra: "Помощь с простой едой сверх пакета",
  urgent: "Срочная заявка",
  transport_expenses: "Транспорт / такси / парковка"
};

export function AgreedTermsSummary({ terms }: { terms: AgreedTerms }) {
  return (
    <section className="details-box agreed-terms-summary">
      <h4>Согласованные условия</h4>
      <div className="detail-grid">
        <span>Пакет / формат помощи</span><strong>{terms.agreedPackageTitle || "Уточнён в чате"}</strong>
        <span>Сумма работы Помощника</span><strong>{rubles(terms.agreedHelperAmount)} ₽</strong>
        <span>Сервисный сбор Заказчика</span><strong>{rubles(terms.customerServiceFeeAmount)} ₽</strong>
        <span>Итого для Заказчика</span><strong>{rubles(terms.customerTotalAmount)} ₽</strong>
        <span>Сервисный сбор Помощника</span><strong>{rubles(terms.helperServiceFeeAmount)} ₽</strong>
        <span>Помощник получит</span><strong>{rubles(terms.helperNetAmount)} ₽</strong>
        {terms.agreedDurationMinutes && <><span>Длительность</span><strong>{formatDuration(terms.agreedDurationMinutes)}</strong></>}
        {terms.agreedScheduledAt && <><span>Дата и время</span><strong>{formatDateRu(terms.agreedScheduledAt)}, {formatTimeRu(terms.agreedScheduledAt)}</strong></>}
        {terms.agreedAddons.length > 0 && <><span>Доплаты</span><strong>{terms.agreedAddons.map((id) => addonLabels[id] ?? id).join(", ")}</strong></>}
        {terms.agreedTermsComment && <><span>Комментарий</span><strong>{terms.agreedTermsComment}</strong></>}
      </div>
      <p className="privacy-note">
        Заказчик: {terms.agreedByCustomerAt ? "условия подтверждены" : "ожидается подтверждение"}. Помощник: {terms.agreedByHelperAt ? "условия подтверждены" : "ожидается подтверждение"}.
      </p>
    </section>
  );
}

function rubles(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} ч` : "", remainder ? `${remainder} мин` : ""].filter(Boolean).join(" ");
}
