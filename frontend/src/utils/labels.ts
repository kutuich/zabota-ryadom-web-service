const statusLabels: Record<string, string> = {
  active: "Активен",
  inactive: "Неактивен",
  archived: "Архив",
  blocked: "Заблокирован",
  draft: "Черновик",
  published: "Опубликована",
  waiting_for_responses: "Ждёт откликов",
  has_responses: "Есть отклики",
  discussion: "Обсуждение условий",
  performer_selected: "Помощник выбран",
  chat_opened: "Чат открыт",
  waiting_client_confirmation: "Ожидает подтверждения заказчика",
  waiting_performer_confirmation: "Ожидает подтверждения помощника",
  waiting_client_balance: "Ожидает пополнения баланса заказчика",
  waiting_performer_balance: "Ожидает пополнения баланса помощника",
  in_progress: "В работе",
  completed: "Выполнена",
  cancelled: "Отменена",
  dispute: "Спор",
  not_agreed: "Не согласовано",
  in_work: "В работе",
  open: "Открыт",
  closed: "Закрыт",
  flagged: "Требует внимания",
  hidden: "Скрыто",
  deleted: "Удалено администратором",
  clean: "Без замечаний",
  pending: "Ожидает решения заказчика",
  new_terms_proposed: "Новое предложение",
  discussion_response: "Обсуждение условий",
  accepted_by_client: "Заказчик выбрал вас",
  rejected_by_client: "Заказчик выбрал другого помощника",
  withdrawn_by_performer: "Вы отозвали отклик",
  expired: "Отклик истёк",
  new: "Новая",
  in_review: "В работе",
  awaiting_user: "Ожидает ответа",
  resolved: "Решена",
  rejected: "Отклонена",
  uploaded: "Загружен",
  verified: "Подтверждён",
  needs_update: "Требует обновления",
  top_up: "Пополнение",
  commission_charge: "Сервисный сбор",
  client_service_fee: "Сервисный сбор заказчика",
  performer_commission: "Сервисный сбор помощника",
  performer_service_fee: "Сервисный сбор помощника",
  admin_bonus: "Бонус администратора",
  refund_bonus: "Компенсация",
  correction: "Корректировка",
  hold: "Блокировка средств",
  release: "Разблокировка средств",
  penalty: "Штраф"
};

const trustLabels: Record<string, string> = {
  new_profile: "Новый",
  phone_verified: "Телефон подтверждён",
  profile_completed: "Профиль заполнен",
  documents_optional: "Документы по желанию",
  trusted_by_reviews: "Есть положительные отзывы",
  manual_verified: "Проверен",
  limited: "Ограничен",
  not_verified: "Не проверен"
};

const selfEmployedLabels: Record<string, string> = {
  self_employed_not_provided: "Не предоставлена",
  self_employed_provided: "Документ загружен",
  self_employed_verified: "Подтверждена",
  self_employed_rejected: "Отклонена",
  needs_update: "Требует обновления"
};

const criminalRecordLabels: Record<string, string> = {
  criminal_record_not_provided: "Не предоставлена",
  criminal_record_uploaded: "Загружена",
  criminal_record_verified: "Подтверждена",
  criminal_record_rejected: "Отклонена",
  needs_update: "Требует обновления"
};

const childcareLabels: Record<string, string> = {
  not_requested: "Нет допуска",
  pending: "На проверке",
  approved: "Допущен",
  rejected: "Отклонён",
  missing_criminal_record: "Требуется справка"
};

export function labelStatus(value?: string | null) {
  if (!value) return "Не указано";
  return statusLabels[value] ?? value;
}

export function labelTrust(value?: string | null) {
  if (!value) return "Новый";
  return trustLabels[value] ?? value;
}

export function labelSelfEmployed(value?: string | null) {
  if (!value) return "Не предоставлена";
  return selfEmployedLabels[value] ?? value;
}

export function labelCriminalRecord(value?: string | null) {
  if (!value) return "Не предоставлена";
  return criminalRecordLabels[value] ?? value;
}

export function labelChildcare(value?: string | null) {
  if (!value) return "Нет допуска";
  return childcareLabels[value] ?? value;
}

export function requestDisplayTitle(request: { publicNumber?: string | null; title: string }) {
  return `${request.publicNumber ?? "Заявка"} — ${request.title}`;
}
