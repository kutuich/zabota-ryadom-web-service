import { MapPin } from "lucide-react";
import type { ClientRequest } from "../types";

export function MapPreview({ requests }: { requests: ClientRequest[] }) {
  const hasYandexKey = Boolean(import.meta.env.VITE_YANDEX_MAPS_API_KEY);
  if (!hasYandexKey) return null;

  return (
    <section className="map-band">
      <div className="map-band__header">
        <MapPin size={18} />
        <span>Карта заявок</span>
      </div>
      <div className="map-grid">
        {requests.slice(0, 8).map((request) => (
          <button key={request.id} className={`map-point map-point--${getMapTone(request)}`} type="button">
            <span>{request.category?.name ?? "заявка"}</span>
            <strong>{request.district ?? request.city?.name ?? "район"}</strong>
            <small>{request.exactAddressVisible ? request.fullAddress ?? request.addressText : request.publicAddress ?? request.approximateAddressText}</small>
          </button>
        ))}
        {requests.length === 0 && <p className="empty-text">Нет заявок для отображения.</p>}
      </div>
    </section>
  );
}

function getMapTone(request: ClientRequest) {
  if (["discussion", "waiting_client_confirmation", "waiting_performer_confirmation", "in_progress", "completed"].includes(request.status)) return "busy";
  if (request.urgency === "urgent") return "urgent";
  if (request.status === "has_responses") return "responses";
  return "fit";
}
