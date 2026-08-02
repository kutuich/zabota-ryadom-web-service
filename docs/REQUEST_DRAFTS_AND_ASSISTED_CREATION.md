# Черновики заявок и помощь сотрудника

## Lifecycle

`RequestDraft` хранится отдельно от `ClientRequest`, поэтому неполная форма не попадает в выдачу Помощникам и не создаёт отклики, чаты или визиты. Черновик содержит allowlisted JSON формы, выбранные/раскрытые node slugs, dynamic fields, расписание, адрес, beneficiary data, последний quote и версии структуры.

- Ручное сохранение и autosave обновляют тот же draft.
- Autosave запускается каждые 30 секунд только при изменениях.
- `revision` реализует optimistic lock; устаревший PATCH получает `409 request_draft_revision_conflict`.
- Каждое сохранение создаёт компактный `RequestDraftRevision`.
- Duplicate создаёт новый draft; delete является soft-delete.
- Publish повторно валидирует город, узлы, поля, relations и blocking safety на backend.
- Publish атомарно создаёт один `ClientRequest`, immutable `RequestCategorySnapshot` и помечает draft converted. Повторный publish идемпотентен.

## Обращение за помощью

Заказчик нажимает «Нужна помощь администратора/менеджера». Перед отправкой форма сохраняется, затем создаётся `RequestDraftSupportCase` с `draftId`, revision и snapshot на момент обращения. Сообщения используют существующие `ServiceConversation` / `ServiceMessage`; JSON черновика в текст уведомления не включается.

Менеджер и Супер-администратор работают в разделе «Запросы помощи по заявкам»: видят данные только для чтения, назначают обращение, отвечают и меняют статус. Ответ переводит обращение в `waiting_for_client`, увеличивает unread и не изменяет revision черновика. Заказчик продолжает редактирование того же draft.

## API

- `GET|POST /api/me/request-drafts`
- `GET|PATCH|DELETE /api/me/request-drafts/:id`
- `POST /api/me/request-drafts/:id/duplicate`
- `POST /api/me/request-drafts/:id/publish`
- `GET|POST /api/me/request-drafts/:id/support-cases`
- `GET /api/admin/request-support-cases`
- `POST /api/admin/request-support-cases/:id/messages`
- `PATCH /api/admin/request-support-cases/:id/status`
- `POST /api/admin/request-support-cases/:id/assign`

Ownership и role checks выполняются backend. JSON очищается от ключей password/token/cookie/authorization/secret, ограничивается по размеру и глубине.
