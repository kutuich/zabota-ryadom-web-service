import type { AgreedTerms, Chat } from "../types";
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

export function AgreedTermsSummary({ terms, agreementVersion }: { terms: AgreedTerms; agreementVersion?: Chat["agreementVersion"] }) {
  const helpTotal = agreementVersion?.totalHelpAmount ?? terms.agreedHelperAmount;
  const customerFee = agreementVersion?.customerServiceFeeTotal ?? terms.customerServiceFeeAmount;
  const helperFee = agreementVersion?.helperServiceFeeTotal ?? terms.helperServiceFeeAmount;
  return (
    <section className="details-box agreed-terms-summary">
      <h4>Согласованные условия</h4>
      <div className="detail-grid">
        <span>Пакет / формат помощи</span><strong>{terms.agreedPackageTitle || "Уточнён в чате"}</strong>
        <span>Согласованная стоимость помощи за график</span><strong>{rubles(helpTotal)} ₽</strong>
        <span>Сервисный сбор Заказчика за график</span><strong>{rubles(customerFee)} ₽</strong>
        <span>Ориентир общих расходов Заказчика</span><strong>{rubles(helpTotal + customerFee)} ₽</strong>
        <span>Сервисный сбор Помощника за график</span><strong>{rubles(helperFee)} ₽</strong>
        <span>Оплата помощи</span><strong>Напрямую между сторонами</strong>
        {terms.agreedDurationMinutes && <><span>Длительность</span><strong>{formatDuration(terms.agreedDurationMinutes)}</strong></>}
        {terms.agreedScheduledAt && <><span>Дата и время</span><strong>{formatDateRu(terms.agreedScheduledAt)}, {formatTimeRu(terms.agreedScheduledAt)}</strong></>}
        {terms.agreedAddons.length > 0 && <><span>Доплаты</span><strong>{terms.agreedAddons.map((id) => addonLabels[id] ?? id).join(", ")}</strong></>}
        {terms.agreedTermsComment && <><span>Комментарий</span><strong>{terms.agreedTermsComment}</strong></>}
      </div>
      <p className="privacy-note">
        Заказчик: {terms.agreedByCustomerAt ? "условия подтверждены" : "ожидается подтверждение"}. Помощник: {terms.agreedByHelperAt ? "условия подтверждены" : "ожидается подтверждение"}.
      </p>
      <p className="privacy-note">Каждая сторона оплачивает свой сервисный сбор отдельно со внутреннего баланса.</p>
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
