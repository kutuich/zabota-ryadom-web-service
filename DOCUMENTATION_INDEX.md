# Индекс документации репозитория

> Статус: ACTIVE INDEX  
> Актуализировано: 2026-08-20

## 1. Назначение

Этот индекс описывает документацию **технической реализации и эксплуатации**, находящуюся в GitHub.

Продуктовая архитектура, бизнес-правила, утверждённые требования, постоянные проектные данные и решения ведутся в **Notion** и не дублируются в GitHub как второй Source of Truth.

## 2. Разрешение конфликтов

1. Явное решение пользователя в текущей задаче.
2. Актуальная утверждённая архитектура и проектные данные в Notion.
3. Утверждённые юридические документы и требования к конкретному изменению.
4. Фактические code/schema/API/tests — источник истины о текущей реализации.
5. Активные domain docs — техническое описание реализации.
6. Operational docs — инструкции запуска, deploy, проверки и эксплуатации.
7. Historical/obsolete документы.

Если код расходится с Notion, это не делает код новым продуктовым правилом. Расхождение фиксируется как implementation gap либо выносится на отдельное архитектурное решение.

## 3. Статусы документов

- `active` — актуальное техническое или процессное описание реализации;
- `operational` — инструкция выполнения операции или snapshot текущего production;
- `draft` — неутверждённый проект/технический черновик;
- `historical` — снимок прошлого состояния, не источник текущих требований;
- `obsolete` — не использовать; должен указывать замену или причину удаления;
- `generated` — машинный артефакт, вручную не редактируется.

Статус `source_of_truth` для продуктовой архитектуры в репозитории больше не используется.

## 4. Активные документы

| Документ | Статус | Назначение |
|---|---|---|
| `README.md` | active | Короткий onboarding, локальный запуск и обзор фактической реализации |
| `AGENTS.md` | active | Обязательный процесс работы Codex/разработчика с репозиторием |
| `docs/REQUEST_WORKFLOW_V2.md` | active | Фактические модели/API/lifecycle request-chat-agreement-visits-fees-reserve-disputes |
| `docs/REQUEST_CALCULATOR.md` | active | Фактический calculator/snapshot/pricing contract |
| `docs/CATEGORY_STRUCTURES.md` | active | Версионные структуры и effective lookup текущей реализации |
| `docs/CATEGORY_IMPORT_EXPORT.md` | operational | JSON/XLSX контракт и безопасный import/export |
| `docs/SERVICE_STRUCTURE_TREE_V1.md` | active | ServiceNode/schema v3 и effective service tree, если файл остаётся актуальным по коду |
| `docs/REQUEST_DRAFTS_AND_ASSISTED_CREATION.md` | active | RequestDraft и assisted creation, если файл остаётся актуальным по коду |
| `docs/AGREEMENT_SCHEDULE_TECHNICAL_DRAFT.md` | draft | Технический состав проекта договора; не юридически утверждённый договор |
| `docs/TBANK_PAYMENT_SETUP.md` | active | Текущая техническая интеграция T-Bank, webhook/refund/NPD |
| `docs/PAYMENT_TEST_CHECKLIST.md` | operational | Ручные банковские test-сценарии |
| `docs/SERVICE_MESSAGES_AND_BROADCASTS.md` | active | In-app сообщения, рассылки и storage |
| `docs/vk-id-auth.md` | active | Текущий VK OAuth flow и настройка |
| `docs/USER_MANAGEMENT_AND_SECURITY.md` | active | Текущие роли, JWT/password/security contracts |
| `docs/PRODUCTION_CURRENT_STATE.md` | operational | Датированный безопасный snapshot фактического production без секретов |
| `docs/PRODUCTION_CHECKLIST.md` | operational | Release/smoke checklist |
| `SECURITY_PRODUCTION_CHECKLIST.md` | operational | Production security checklist |
| `docs/DEPLOY_TIMEWEB.md` | operational | Текущий deploy/Caddy/backup/rollback |
| `docs/DEPLOY_BUTTON.md` | operational | Процедура deploy command |
| `docs/CODE_AUDIT_BUTTON.md` | operational | Read-only code audit |
| `docs/VISUAL_AUDIT_BUTTON.md` | operational | Visual audit; не заменяет реальный E2E |
| `docs/CHANGE_MANAGEMENT.md` | active | Engineering change process |
| `docs/DECISIONS_LOG.md` | historical | История значимых решений; не текущий Source of Truth |
| `docs/DOCUMENTATION_AUDIT_2026-07-30.md` | historical | Закрытый снимок старого аудита; не обновлять |
| `landing-public/README.md` | active | Границы static landing component |

Перед заменой этого индекса нужно сверить фактическое наличие перечисленных файлов в текущей ветке. Если документ отсутствует, его строка удаляется или документ восстанавливается только при реальной необходимости.

## 5. Что не должно быть Source of Truth в GitHub

Устаревшие локальные сводные документы с продуктовыми требованиями не должны использоваться как нормативные документы проекта и не должны возвращаться в активную ветку.

Старые TheBrain exports, Markdown snapshots и audit reports не должны использоваться Codex как источник актуальной архитектуры.

## 6. Правило обновления

- Изменился код/API/schema → обновить соответствующий domain doc и tests.
- Изменилась эксплуатационная процедура → обновить operational doc.
- Изменился production → обновить `PRODUCTION_CURRENT_STATE.md` только после подтверждения фактического состояния, без секретов.
- Изменилась продуктовая архитектура → обновляется Notion; GitHub-документация меняется только в части фактической реализации после изменения кода.
- Изменилось обязательное правило работы Codex → обновить `AGENTS.md`.
- Значимое историческое решение можно добавить в `DECISIONS_LOG.md`, но журнал не заменяет Notion.
