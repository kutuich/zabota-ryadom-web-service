import type { PricingQuote } from "../types";

export const clientPriceExplanation =
  "Мы рассчитали рекомендуемую оплату с учётом выбранного формата визита, длительности и объёма помощи. Оплата за работу передаётся помощнику напрямую, сервисный сбор оплачивается отдельно. Если в чате изменятся объём, продолжительность или условия визита, согласуйте итоговую оплату до начала работы.";

export const performerPriceExplanation =
  "Рекомендуемая оплата рассчитана по указанному заказчиком объёму и условиям. Если фактическая задача отличается от заявки, согласуйте изменения с заказчиком до начала дополнительной работы.";

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
  const performerNet = pricing?.performerNetAmount ?? Math.max(0, payment - performerFee);
  const visitFormat = pricing?.packageLabel ?? pricing?.visitFormat ?? pricing?.packageName;
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
          <strong>{payment} ₽</strong>
          <dl>
            <div><dt>Рекомендуемая оплата за визит</dt><dd>{payment} ₽</dd></div>
            <div><dt>Сервисный сбор помощника</dt><dd>{performerFee} ₽</dd></div>
            <div><dt>Ориентировочный доход после сервисного сбора</dt><dd>{performerNet} ₽</dd></div>
          </dl>
          <p>{performerPriceExplanation}</p>
        </>
      ) : (
        <>
          <strong>{payment} ₽</strong>
          <dl>
            <div><dt>Рекомендуемая оплата помощнику</dt><dd>{payment} ₽</dd></div>
            <div><dt>Сервисный сбор заказчика</dt><dd>{clientFee} ₽</dd></div>
            <div><dt>Ориентировочные общие расходы</dt><dd>{clientTotal} ₽</dd></div>
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
    </section>
  );
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
