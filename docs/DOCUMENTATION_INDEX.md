# Индекс документации

> Статус: ACTIVE INDEX  
> Актуализировано: 2026-08-21

## Разрешение конфликтов

1. Явное решение пользователя в текущей задаче, если оно не противоречит утверждённой архитектуре.
2. Утверждённая продуктовая архитектура проекта в Notion.
3. Фактический код, schema и API в GitHub/локальной рабочей копии как источник текущего технического состояния.
4. Доменный технический документ как описание реализации.
5. README и operational checklist.
6. Historical/obsolete документы только как история, но не как текущие требования.

Notion отвечает на вопрос «как продукт должен работать». Репозиторий отвечает на вопрос «как он реализован сейчас». Расхождение между ними фиксируется явно и не разрешается ссылкой на устаревший локальный сводный документ.

## Активные документы

| Документ | Статус | Назначение | Когда обновлять | Главнее какого документа |
|---|---|---|---|---|
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
| [`TESTING.md`](TESTING.md) | active | Vitest baseline, characterization coverage и подготовка test DB | При изменении test runner или стратегии тестирования | Локальные заметки о запуске тестов |
| [`POSTGRESQL_MIGRATION_REHEARSAL.md`](POSTGRESQL_MIGRATION_REHEARSAL.md) | operational | Локальный перенос SQLite-копии, проверка целостности и PostgreSQL smoke | При изменении schema, migration scripts или cutover-плана | Старые инструкции `db push` |
| [`NESTJS_MIGRATION.md`](NESTJS_MIGRATION.md) | active | Фактическое состояние перехода Express -> NestJS, ownership доменов и критерии удаления bridge | При переносе backend routes или lifecycle | README по backend framework |
| [`API_OPENAPI.md`](API_OPENAPI.md) | active | Генерация OpenAPI, Swagger exposure, contract inventory и известная точность схем | При изменении HTTP routes, DTO или OpenAPI infrastructure | README по API contract |
| [`SECURITY_PRODUCTION_CHECKLIST.md`](../SECURITY_PRODUCTION_CHECKLIST.md) | operational | Security review production | При изменении auth/storage/payments/workflow | Не главнее domain security rules |
| [`CHANGE_MANAGEMENT.md`](CHANGE_MANAGEMENT.md) | active | Процесс будущих изменений | При изменении engineering process | README по процессу |
| [`DECISIONS_LOG.md`](DECISIONS_LOG.md) | historical | Краткая история утверждённых решений | При каждом новом/изменённом решении | Старые отчёты, но не current source |
| [`DOCUMENTATION_AUDIT_2026-07-30.md`](DOCUMENTATION_AUDIT_2026-07-30.md) | historical | Снимок аудита 2026-07-30 | Не обновлять после закрытия аудита | Никакого актуального документа |
| [`landing-public/README.md`](../landing-public/README.md) | active | Границы static landing component | При изменении routing/landing ownership | Только исторические landing notes |

## Правило статусов

- `active` — актуальное техническое или процессное описание;
- `operational` — инструкция выполнения операции;
- `draft` — неутверждённый проект;
- `historical` — снимок прошлого состояния, не источник текущих требований;
- `obsolete` — не использовать; файл обязан ссылаться на замену;
- `generated` — машинный артефакт, не редактируется вручную.
- [User Management & Security](./USER_MANAGEMENT_AND_SECURITY.md) — роли, пароли, отзыв JWT, профиль и security audit.
