# Структуры услуг

> Статус: ACTIVE TECHNICAL DOCUMENT.

## Версии и effective merge

`CategoryStructure` имеет scope `federal | region | city` и status `draft | active | archived`. Effective-каталог объединяется снизу вверх: РФ, регион, город. Совпадающие `category slug` и `task slug` переопределяются более точным слоем; отсутствующие в нём элементы наследуются. Отключённый элемент верхнего слоя скрывает унаследованный.

Active нельзя редактировать. Импорт всегда создаёт новую draft-версию, активация архивирует прежнюю active того же scope и записывает `activatedAt`. Действие «Создать новую версию на основе этой» после подтверждения клонирует выбранную версию в новый draft; старая запись не возвращается в active. Сравнение версий показывает добавленные, удалённые и изменённые категории, задачи и ценовые правила.

Версия хранится нормализованной строкой без префикса `v`. Поддерживаются `MAJOR.MINOR` и `MAJOR.MINOR.PATCH`; сравнение выполняется по числовым сегментам: `2.10 > 2.9`, `2.0 < 2.0.1 < 2.1`.

## Lifecycle и удаление

- Никогда не публиковавшийся draft можно удалить после server-side проверки зависимостей и комментария администратора.
- Active физически не удаляется. Для вредящей версии используется экстренное отключение с возвратом к последней опубликованной версии scope либо к родительскому fallback.
- Archived скрыта из обычного списка. Удаление возможно только при нулевых snapshot, заявках, соглашениях, визитах, финансовых batch, дочерних структурах, настройках Помощников и pending revisions. Требуется точная подтверждающая фраза.
- AuditLog удаления сохраняется отдельно.

Dependency check повторяется внутри транзакции удаления. Старая `RequestCategorySnapshot` не изменяется: актуализация создаёт `RequestStructureUpdateRevision`, а после подтверждения Заказчиком — новый snapshot. Опубликованная заявка с pending revision скрывается backend из общей выдачи Помощникам. Финализированная заявка без процедуры финансовой delta не мигрируется.

## Публичный каталог v2

Версия РФ 2.0 задаёт четыре корневых направления:

1. `home-help` — Помощь по дому;
2. `supervision` — Уход на дому;
3. `shopping-delivery` — Покупки и поручения;
4. `accompaniment` — Сопровождение.

Техническая иерархия flatten-ится в `directions[].tasks[]`. Выбор хранится как `selectedTasks[]`; ограничение на одну дополнительную задачу отсутствует. Одна задача идентифицируется category/subcategory/template ids. Названия, описания, поисковые aliases, рекомендации, ограничения и `formFields` импортируются вместе со структурой.

Поддерживаемые динамические поля: `text`, `textarea`, `number`, `select`, `checkbox`, `time`. Backend повторно проверяет обязательность, диапазон числа и допустимое значение select. Изменить форму для задачи можно новой версией JSON без изменения React-компонента.

Скрытые legacy categories не предлагаются в новой форме, но не удаляются из исторических заявок. Частота и срочность не являются категориями.

## Pricing metadata

`CategoryPricingRule` принадлежит версии структуры и может быть связан с конкретной задачей. `recommendedPackageCode` группирует действия одного пакета, поэтому несколько входящих в него задач не тарифицируются повторно. Несвязанные правила суммируются. Новая заявка не зависит от глобального legacy package catalog. Draft/archived rules не участвуют в effective расчёте.

## RequestCategorySnapshot v2

Snapshot содержит effective structure, полный `structureLayers` РФ/региона/города, recipient/dependent state, `selectedTasks`, `taskFieldValues`, frequency, schedule rules, visit slots, preliminary expanded visits, visit count, total duration, pricing breakdown, unpriced tasks, fee totals, safety rules и timestamp.

Связь snapshot с финальными visits косвенная: при согласовании из него берутся исходные задачи/график, затем создаётся новая `AgreementVersion`. Финальные `RequestVisit` создаются только после двойного подтверждения.

Legacy snapshots без `schemaVersion: 2` продолжают читаться; автоматическое переписывание запрещено.

## Права и безопасность

- admin/superadmin создаёт drafts, импортирует, публикует и архивирует;
- manager может читать структуру и переклассифицировать незакрытую заявку, но не менять справочник;
- медицинские, ремонтные, технические и опасные задачи не публикуются как бытовая помощь;
- helper preferences сохраняют ids и stable slugs по городу;
- audit фиксирует create/import/export/publish/archive/rollback/reclassification.

## Поставляемые структуры 2.0

- `backend/prisma/structures/russia-v2.json` — полный федеральный каталог;
- `backend/prisma/structures/khmao-v2.json` — региональный overlay ХМАО - Югра;
- `backend/prisma/structures/yugorsk-v2.json` — локальный overlay Югорска.

Demo seed создаёт и активирует отсутствующие версии 2.0 идемпотентно. В production импорт и активация выполняются администратором отдельно; feature не меняет production env и не выполняет deploy.

См. [калькулятор](REQUEST_CALCULATOR.md) и [импорт/экспорт](CATEGORY_IMPORT_EXPORT.md).
# Дополнение schema v3

Универсальное дерево, stable-key merge и relation types описаны в [SERVICE_STRUCTURE_TREE_V1.md](SERVICE_STRUCTURE_TREE_V1.md). Legacy Category/TaskTemplate сохранены как compatibility layer.
