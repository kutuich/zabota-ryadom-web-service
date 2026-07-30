import type { PricingQuote } from "../types";

export const clientPriceExplanation =
  "Точная стоимость согласовывается в чате до двойного подтверждения. Действия внутри выбранного пакета и согласованного времени не создают отдельную доплату.";

export const performerPriceExplanation =
  "Точная стоимость согласовывается с Заказчиком до двойного подтверждения. Изменение времени, адреса или характера заявки нужно согласовать отдельно.";

export function PriceSummary({
  pricing,
  role = "client",
  fallbackPayment,
  fallbackServiceFee = 0
}: {
  pricing?: PricingQuote | null;
  role?: "client" | "performer" | "admin";
  fallbackPayment?: number | null;
  fallbackServiceFee?: number;
}) {
  const payment = pricing?.performerPaymentAmount ?? fallbackPayment ?? 0;
  const clientFee = pricing?.clientServiceFeeAmount ?? fallbackServiceFee;
  const clientTotal = pricing?.clientTotalExpense ?? payment + clientFee;
  const performerFee = pricing?.performerServiceFeeAmount ?? pricing?.performerCommissionAmount ?? fallbackServiceFee;
  const visitFormat = pricing?.packageLabel ?? pricing?.visitFormat ?? pricing?.packageName;
  const packageRange = pricing ? formatRange(pricing.packagePriceMin, pricing.packagePriceMax) : null;
  const customerRange = pricing ? formatRange(pricing.customerTotalMin, pricing.customerTotalMax) : null;
  const reasons = pricing?.recommendationReasons?.length ? pricing.recommendationReasons : pricing?.increaseFactors ?? [];
  const included = pricing?.includedActions?.length ? pricing.includedActions : pricing?.included ?? [];
  const notIncluded = pricing?.notIncluded?.length ? pricing.notIncluded : pricing?.excluded ?? [];

  if (!pricing && !fallbackPayment) {
    return (
      <section className="price-summary">
        <p className="eyebrow">Рекомендуемая стоимость визита</p>
        <strong>Рекомендуемая стоимость визита будет рассчитана после выбора категории и длительности.</strong>
      </section>
    );
  }

  return (
    <section className="price-summary">
      <p className="eyebrow">Рекомендуемая стоимость визита</p>
      {role === "performer" ? (
        <>
          <strong>{packageRange ?? `${payment} ₽`}</strong>
          <dl>
            <div><dt>Согласованная стоимость помощи</dt><dd>{packageRange ?? `${payment} ₽`}</dd></div>
            <div><dt>Сервисный сбор помощника</dt><dd>{performerFee} ₽</dd></div>
            <div><dt>Оплата помощи</dt><dd>Напрямую от Заказчика</dd></div>
          </dl>
          <p>{performerPriceExplanation} Сервисный сбор оплачивается сервису отдельно со внутреннего баланса.</p>
        </>
      ) : (
        <>
          <strong>{packageRange ?? `${payment} ₽`}</strong>
          <dl>
            <div><dt>Стоимость помощи Помощника</dt><dd>{packageRange ?? `${payment} ₽`}</dd></div>
            <div><dt>Сервисный сбор заказчика</dt><dd>{clientFee} ₽</dd></div>
            <div><dt>Итого расходы Заказчика</dt><dd>{customerRange ?? `${clientTotal} ₽`}</dd></div>
            {role === "admin" && <div><dt>Сервисный сбор помощника</dt><dd>{performerFee} ₽</dd></div>}
          </dl>
          <p>{clientPriceExplanation}</p>
        </>
      )}
      {visitFormat && <small>Рекомендуемый формат визита: {visitFormat}</small>}
      {reasons.length ? <small>Почему выбран формат: {reasons.slice(0, 4).join(", ")}</small> : null}
      {pricing?.warnings?.length ? (
        <ul className="compact-list warning-list">
          {pricing.warnings.slice(0, 3).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {(included.length > 0 || notIncluded.length > 0 || pricing?.requiredConfirmations?.length) && (
        <details className="details-box price-summary__details">
          <summary>Что входит, что не входит и что согласовать</summary>
          {included.length > 0 && (
            <>
              <h4>Что входит</h4>
              <ul>{included.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          )}
          {notIncluded.length > 0 && (
            <>
              <h4>Что не входит</h4>
              <ul>{notIncluded.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          )}
          {pricing?.requiredConfirmations?.length ? (
            <>
              <h4>Что нужно согласовать</h4>
              <ul>{pricing.requiredConfirmations.map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          ) : null}
        </details>
      )}
      {pricing?.possibleAddons?.length ? (
        <details className="details-box price-summary__details">
          <summary>Возможные доплаты</summary>
          <ul>{pricing.possibleAddons.map((item) => <li key={item.id}>{item.title}: {item.priceLabel}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}

function formatRange(min?: number, max?: number | null) {
  if (min === undefined) return null;
  if (max === null || max === undefined) return `от ${formatMoney(min)} ₽`;
  if (min === max) return `${formatMoney(min)} ₽`;
  return `${formatMoney(min)}–${formatMoney(max)} ₽`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function parsePricing(value?: string | null): PricingQuote | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
