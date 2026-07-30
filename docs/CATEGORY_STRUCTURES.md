# Структуры категорий

> Статус: ACTIVE TECHNICAL DOCUMENT.

## Версии и fallback

`CategoryStructure` имеет scope federal/region/city и status draft/active/archived. Effective structure выбирается `active city -> active region -> active federal`; использованные версии физически не удаляются. Active нельзя редактировать: создаётся draft следующей версии, публикация архивирует прежнюю active того же scope.

## Публичный каталог v2

Новая форма показывает только четыре корневых slug в стабильном порядке:

1. `home-help` — Помощь по дому;
2. `supervision` — Уход на дому;
3. `shopping-delivery` — Покупки и поручения;
4. `accompaniment` — Сопровождение.

Техническая иерархия flatten-ится в `directions[].tasks[]`. Выбор хранится как `selectedTasks[]`; одна задача идентифицируется category/subcategory/template ids. Поисковые aliases сейчас вычисляются кодом (`taskAliases`) и не являются импортируемым полем структуры.

Скрытые legacy categories не предлагаются в новой форме, но не удаляются из исторических заявок. Частота и срочность не являются категориями.

## Pricing metadata

`CategoryPricingRule` принадлежит версии структуры. `recommendedPackageCode` может группировать правило, но новая заявка не зависит от глобального legacy package catalog. Draft/archived rules не участвуют в effective расчёте.

## RequestCategorySnapshot v2

Snapshot содержит structure id/title/version/scope, fallback, recipient/dependent state, `selectedTasks`, frequency, schedule rules, visit slots, preliminary expanded visits, visit count, total duration, pricing breakdown, unpriced tasks, fee totals, safety rules и timestamp.

Связь snapshot с финальными visits косвенная: при согласовании из него берутся исходные задачи/график, затем создаётся новая `AgreementVersion`. Финальные `RequestVisit` создаются только после двойного подтверждения.

Legacy snapshots без `schemaVersion: 2` продолжают читаться; автоматическое переписывание запрещено.

## Права и безопасность

- admin/superadmin создаёт drafts, импортирует, публикует и архивирует;
- manager может читать структуру и переклассифицировать незакрытую заявку, но не менять справочник;
- медицинские, ремонтные, технические и опасные задачи не публикуются как бытовая помощь;
- helper preferences сохраняют ids и stable slugs по городу;
- audit фиксирует create/import/export/publish/archive/reclassification.

См. [калькулятор](REQUEST_CALCULATOR.md) и [импорт/экспорт](CATEGORY_IMPORT_EXPORT.md).
