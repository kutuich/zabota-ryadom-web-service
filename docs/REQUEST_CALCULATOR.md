# Калькулятор заявки v2

> Статус: ACTIVE TECHNICAL DOCUMENT.

## Вход

`POST /api/requests/calculate-price` принимает `cityId`, состояние Подопечного, `selectedTasks[]`, frequency и конечный schedule. Backend — единственный источник totals; устаревшие ответы frontend отменяются/игнорируются UI при изменении ввода.

Каталог строится из active effective structure: `city -> region -> federal`. `Category -> child Category -> CategoryTaskTemplate` преобразуется в плоские selectable tasks. Draft/archived структуры и скрытые legacy-направления не участвуют.

Заказчик может выбрать любое число задач из нескольких направлений. Identity задачи: `categoryId + subcategoryId + taskTemplateId`; дубли отклоняются.

## Pricing resolution

Для каждой выбранной задачи backend проверяет принадлежность effective structure. Pricing rule берётся с подкатегории, затем с корневого направления. Задачи, покрытые одной rule/package metadata, группируются по rule id и не считаются дважды.

Возможны:

- package/rule покрывает все выбранные задачи;
- package/rule плюс оставшиеся отдельные задачи;
- несколько отдельных rules;
- `unpricedTasks`, которые остаются по согласованию.

Импортируемый `recommendedPackageCode` является metadata версионной структуры, а не глобальным обязательным package catalog. Legacy `pricingService` остаётся только для старых API/заявок.

## Один визит

`calculateRecommendedAmount()` выбирает сумму внутри range с учётом frequency и duration: короткий простой формат ближе к min, обычный — midpoint, увеличенная длительность или срочность — max. До 1 000 ₽ округление выполняется к 50 ₽, от 1 000 ₽ — к 100 ₽.

Состояние Подопечного и safety flags сохраняются в snapshot. Они не дают права добавлять медицинские процедуры. Ожидание/срочность учитываются только когда это выражено rule/input; действие, уже входящее в правило и время, не тарифицируется повторно.

## Период

Каждый expanded visit рассчитывается отдельно по своей дате, времени и `durationMinutes`. Явный `defaultDurationMinutes` активного правила имеет приоритет; для старых активных правил без значения применяется совместимый ориентир 120 минут. Слоты сортируются по времени, но сохраняют стабильные входные id.

```text
visitCount = число expanded visits
totalDurationMinutes = сумма durationMinutes
totalHelpAmount = сумма calculatedHelpPrice всех expanded visits
customerServiceFeeTotal = visitCount × 50
helperServiceFeeTotal = visitCount × 50
```

`perVisitHelpAmount` возвращается только для однородного графика. Для разных цен он равен `null`, даже если точный `totalHelpAmount` известен. Если есть unpriced task, `totalHelpAmount` возвращается `null`; `calculatedSubtotal`, рассчитанные rules и точные unpriced tasks показываются раздельно.

Контрольный график на пять дней: 60 минут, 120 минут и 180 минут ежедневно. Это 15 визитов и 30 часов. При текущем активном тестовом правиле ориентиры составляют 700/900/1 100 ₽, итог помощи — 13 500 ₽. Сборы остаются 750 ₽ с каждой стороны и не зависят от длительности.

## Ответ и snapshot

Ответ содержит `expandedVisits[]` с `calculatedEndTime`, `calculatedHelpPrice`, `calculatedSubtotal`, per-visit breakdown/fees/unpriced tasks, а также period totals, `dailyBreakdown`, effective structure, pricing source, предупреждения и `calculatedAt`.

При создании `RequestCategorySnapshot` сохраняет schema v2. При согласовании калькуляция фиксируется заново в immutable `AgreementVersion`; предварительный quote не заменяет согласованную стоимость.

## Безопасность

- запрещённые медицинские термины дают предупреждение/validation error;
- сопровождение требует текстового уточнения;
- schedule конечный и ограничен `MAX_SCHEDULE_VISITS`;
- слоты не пересекаются и не выходят за сутки;
- устаревшие totals frontend не принимаются;
- старые snapshots не переписываются.
