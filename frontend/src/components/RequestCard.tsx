import { CheckCircle2, Clock, MapPin, MessageCircle, Send } from "lucide-react";
import type { ClientRequest } from "../types";
import { StatusBadge, statusTone } from "./StatusBadge";
import { labelStatus, requestDisplayTitle } from "../utils/labels";
import { parsePricing, PriceSummary } from "./PriceSummary";
import { buildPublicAddressFromRequest, buildYandexExactAddressFromRequest, buildYandexMapsSearchUrl } from "../utils/address";
import { formatDateRu, formatTimeRu } from "../utils/dateTime";
import { AgreedTermsSummary } from "./AgreedTermsSummary";

export function RequestCard({
  request,
  actionLabel,
  onAction,
  onTitleClick,
  priceRole = "client",
  children
}: {
  request: ClientRequest;
  actionLabel?: string;
  onAction?: () => void;
  onTitleClick?: () => void;
  priceRole?: "client" | "performer" | "admin";
  children?: React.ReactNode;
}) {
  const pricing = request.pricing ?? parsePricing(request.pricingBreakdownJson);
  const agreedTerms = request.chat?.agreedTerms ?? request.chats?.find((chat) => chat.agreedTerms)?.agreedTerms ?? null;
  const performerPayment = agreedTerms?.agreedHelperAmount ?? pricing?.performerPaymentAmount ?? request.priceEstimateAmount ?? request.budgetAmount ?? pricing?.total ?? 0;
  const builtPublicAddress = buildPublicAddressFromRequest(request);
  const publicAddress = request.yandexPublicMapAddress || builtPublicAddress || request.publicAddress || "";
  const exactAddress = request.yandexExactMapAddress ?? buildYandexExactAddressFromRequest(request);
  const visibleAddress = request.exactAddressVisible
    ? priceRole === "client"
      ? request.fullAddress ?? exactAddress
      : exactAddress
    : publicAddress;
  const mapAddress = request.exactAddressVisible
    ? exactAddress
    : request.yandexPublicMapAddress ?? publicAddress;
  const mapUrl = (request.exactAddressVisible ? request.yandexExactMapUrl : request.yandexPublicMapUrl) || buildYandexMapsSearchUrl(mapAddress);
  return (
    <article className="card request-card">
      <div className="card__head">
        <div>
          <p className="eyebrow">{request.category?.name ?? "категория"}</p>
          <h3>
            {onTitleClick ? (
              <button className="link-button" type="button" onClick={onTitleClick}>
                {requestDisplayTitle(request)}
              </button>
            ) : (
              requestDisplayTitle(request)
            )}
          </h3>
        </div>
        <StatusBadge tone={statusTone(request.status)}>{labelStatus(request.status)}</StatusBadge>
      </div>
      {request.createdByRole === "manager" && priceRole === "client" && (
        <p className="notice manager-request-origin">Заявка создана при помощи менеджера сервиса.</p>
      )}
      <p>{request.description}</p>
      <div className="meta-row">
        <span>
          <MapPin size={16} />
          {visibleAddress}
        </span>
        <span>
          <Clock size={16} />
          {request.date ? formatDateRu(request.date) : "дата не выбрана"}
          {request.timeFrom ? `, ${formatTimeRu(request.timeFrom)}` : ""}
        </span>
        <span>
          <CheckCircle2 size={16} />
          {performerPayment
            ? agreedTerms ? `Согласованная оплата ${performerPayment} ₽` : `Рекомендуемая оплата ${performerPayment} ₽`
            : "Рекомендуемая стоимость визита будет рассчитана"}
        </span>
      </div>
      {agreedTerms ? <AgreedTermsSummary terms={agreedTerms} /> : (pricing || performerPayment > 0) && (
        <PriceSummary
          pricing={pricing}
          fallbackPayment={performerPayment}
          fallbackServiceFee={request.city?.defaultCommissionAmount ?? 0}
          role={priceRole}
        />
      )}
      <div className="condition-row">
        {request.urgency === "urgent" && <StatusBadge tone="danger">срочно</StatusBadge>}
        {request.urgency === "regular" && <StatusBadge tone="info">регулярная помощь</StatusBadge>}
        {request.hasElderlyPerson && <StatusBadge tone="neutral">пожилой человек</StatusBadge>}
        {request.hasChild && <StatusBadge tone="warning">ребёнок</StatusBadge>}
        {request.hasLimitedMobility && <StatusBadge tone="warning">маломобильный человек</StatusBadge>}
        {request.needsCooking && <StatusBadge tone="neutral">готовка</StatusBadge>}
        {request.needsCleaning && <StatusBadge tone="neutral">уборка</StatusBadge>}
        {request.needsWalk && <StatusBadge tone="neutral">прогулка</StatusBadge>}
        {request.needsHygieneHelp && <StatusBadge tone="warning">бытовая гигиеническая помощь</StatusBadge>}
        {request.hasPets && <StatusBadge tone="neutral">есть животные</StatusBadge>}
      </div>
      {request.comment && <p className="privacy-note">{request.comment}</p>}
      {priceRole === "client" ? (
        <>
          {request.addressComment && <p className="privacy-note">Комментарий к адресу: {request.addressComment}</p>}
          <p className="privacy-note">Помощник увидит точный адрес только после согласования условий и перехода заявки в работу.</p>
        </>
      ) : !request.exactAddressVisible ? (
        <p className="privacy-note">Точный адрес будет доступен после согласования условий и перехода заявки в работу.</p>
      ) : (
        <div className="details-box">
          <strong>Дополнительно</strong>
          <p>{formatAddressDetails(request)}</p>
          {request.addressComment && <p>Комментарий: {request.addressComment}</p>}
        </div>
      )}
      {mapUrl && (
        <a className="secondary-button" href={mapUrl} target="_blank" rel="noreferrer">
          {request.exactAddressVisible ? "Открыть точный адрес на Яндекс.Картах" : "Открыть на Яндекс.Картах"}
        </a>
      )}
      {children}
      {actionLabel && onAction && (
        <button className="primary-button" type="button" onClick={onAction}>
          {actionLabel.includes("Отклик") ? <Send size={18} /> : <MessageCircle size={18} />}
          {actionLabel}
        </button>
      )}
    </article>
  );
}

function formatAddressDetails(request: ClientRequest) {
  return [
    request.addressEntrance ? `подъезд ${request.addressEntrance}` : "",
    request.addressFloor ? `этаж ${request.addressFloor}` : "",
    request.addressApartment ? `квартира ${request.addressApartment}` : "",
    request.addressIntercom ? `домофон ${request.addressIntercom}` : ""
  ].filter(Boolean).join(", ") || "дополнительные данные не указаны";
}
