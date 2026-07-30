# Индекс документации

> Статус: ACTIVE INDEX  
> Актуализировано: 2026-07-30

## Разрешение конфликтов

1. Утверждённое решение пользователя в текущей задаче.
2. [`ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md`](../ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md).
3. Доменный технический документ.
4. Фактическая schema/API как реализация; расхождение с нормативным документом фиксируется как bug или documentation gap.
5. README и operational checklist.
6. Historical/obsolete документы.

## Активные документы

| Документ | Статус | Назначение | Когда обновлять | Главнее какого документа |
|---|---|---|---|---|
| [`ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md`](../ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md) | source_of_truth | Продуктовые решения и границы | При изменении утверждённого решения | Всех технических и operational документов |
| [`README.md`](../README.md) | active | Короткий onboarding и запуск | При изменении запуска, стека или верхнеуровневой архитектуры | Только component README |
| [`AGENTS.md`](../AGENTS.md) | active | Обязательный процесс для разработчика/Codex | При изменении обязательных правил работы | README по процессу разработки |
| [`REQUEST_WORKFLOW_V2.md`](REQUEST_WORKFLOW_V2.md) | active | Модели, API, lifecycle, fees, visits, reserve, disputes | При изменении request/chat/visit workflow | Operational checklist по реализации |
| [`REQUEST_CALCULATOR.md`](REQUEST_CALCULATOR.md) | active | `selectedTasks[]`, effective pricing и quote | При изменении calculator/snapshot | Примеры расчёта в checklists |
| [`CATEGORY_STRUCTURES.md`](CATEGORY_STRUCTURES.md) | active | Версионные структуры и snapshot v2 | При изменении category models/effective lookup | Import/export guide по доменной семантике |
| [`CATEGORY_IMPORT_EXPORT.md`](CATEGORY_IMPORT_EXPORT.md) | operational | Реальный JSON/XLSX контракт и безопасный импорт | При изменении import/export contract | UI-подсказки импорта |
| [`AGREEMENT_SCHEDULE_TECHNICAL_DRAFT.md`](AGREEMENT_SCHEDULE_TECHNICAL_DRAFT.md) | draft | Технический состав будущего документа | При изменении agreement/visit fields | Никакого юридического документа |
| [`TBANK_PAYMENT_SETUP.md`](TBANK_PAYMENT_SETUP.md) | active | Архитектура T-Bank, env names, refunds, NPD | При изменении payment adapter/webhook | Payment checklist по техническим правилам |
| [`PAYMENT_TEST_CHECKLIST.md`](PAYMENT_TEST_CHECKLIST.md) | operational | Ручной test-terminal сценарий | При изменении банковского сценария | Не главнее payment setup |
| [`SERVICE_MESSAGES_AND_BROADCASTS.md`](SERVICE_MESSAGES_AND_BROADCASTS.md) | active | In-app сообщения, рассылки, вложения | При изменении messages/broadcasts/storage | UI-подсказки домена |
| [`vk-id-auth.md`](vk-id-auth.md) | active | VK OAuth flow и настройка | При изменении OAuth endpoints/env | README по OAuth |
| [`PRODUCTION_CURRENT_STATE.md`](PRODUCTION_CURRENT_STATE.md) | operational | Безопасный snapshot production без секретов | После подтверждённого изменения production | Старые deployment assumptions |
| [`PRODUCTION_CHECKLIST.md`](PRODUCTION_CHECKLIST.md) | operational | Release/smoke checklist | При изменении deploy или критичного workflow | Не главнее domain docs |
| [`DEPLOY_TIMEWEB.md`](DEPLOY_TIMEWEB.md) | operational | Deploy, Caddy, backup, rollback | При изменении production runtime | `DEPLOY_BUTTON.md` по процедуре |
| [`DEPLOY_BUTTON.md`](DEPLOY_BUTTON.md) | operational | Работа deploy command | При изменении deploy script | Не главнее deploy guide |
| [`CODE_AUDIT_BUTTON.md`](CODE_AUDIT_BUTTON.md) | operational | Read-only code audit | При изменении audit script/checks | Не главнее source/domain docs |
| [`VISUAL_AUDIT_BUTTON.md`](VISUAL_AUDIT_BUTTON.md) | operational | Локальный mock visual audit | При изменении visual script/routes/viewports | Не заменяет E2E docs |
| [`SECURITY_PRODUCTION_CHECKLIST.md`](../SECURITY_PRODUCTION_CHECKLIST.md) | operational | Security review production | При изменении auth/storage/payments/workflow | Не главнее domain security rules |
| [`CHANGE_MANAGEMENT.md`](CHANGE_MANAGEMENT.md) | active | Процесс будущих изменений | При изменении engineering process | README по процессу |
| [`DECISIONS_LOG.md`](DECISIONS_LOG.md) | historical | Краткая история утверждённых решений | При каждом новом/изменённом решении | Старые отчёты, но не current source |
| [`DOCUMENTATION_AUDIT_2026-07-30.md`](DOCUMENTATION_AUDIT_2026-07-30.md) | historical | Снимок аудита 2026-07-30 | Не обновлять после закрытия аудита | Никакого актуального документа |
| [`landing-public/README.md`](../landing-public/README.md) | active | Границы static landing component | При изменении routing/landing ownership | Только исторические landing notes |

## Правило статусов

- `source_of_truth` — нормативное продуктовое решение;
- `active` — актуальное техническое или процессное описание;
- `operational` — инструкция выполнения операции;
- `draft` — неутверждённый проект;
- `historical` — снимок прошлого состояния, не источник текущих требований;
- `obsolete` — не использовать; файл обязан ссылаться на замену;
- `generated` — машинный артефакт, не редактируется вручную.
