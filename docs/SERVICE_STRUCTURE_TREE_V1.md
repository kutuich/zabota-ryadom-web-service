# Service Structure Tree v1

## Назначение

Schema v3 расширяет действующий Service Structure Engine РФ → регион → город. Она не заменяет legacy `Category` / `CategoryTaskTemplate`: структуры schema v2 продолжают читаться через compatibility DTO.

## Модель

- `ServiceNode` — узел произвольной глубины. Родитель задаётся `parentId`, merge выполняется по `stableKey`.
- `ServiceNodeRelation` — связь `includes`, `suggests`, `requires`, `excludes`, `alternative_to`, `available_separately`, `included_when_selected`, `sequence_after`, `sequence_before` или `conditional`.
- `ServiceNodePricingRule` — точное либо унаследованное от ближайшего предка правило цены; `packageCode` дедуплицирует пакет, `coveredNodeSlugs` исключает повторное начисление.
- `ServiceNodeSafetyRule` — warning или blocking-правило с машиночитаемой applicability.

Защитный предел рекурсии равен 64 уровням и нужен только для повреждённых данных. Бизнес-модель не содержит фиксированных полей уровней.

## Импорт и effective merge

JSON schema v3 содержит `nodes`, `relations`, `nodePricingRules`, `nodeSafetyRules`. XLSX использует листы «Узлы», «Связи узлов», «Цены узлов» и «Ограничения узлов». Preview отклоняет цикл, orphan, self-parent, duplicate slug и неизвестные ссылки.

Effective tree строится слоями РФ → регион → город. Последующий слой заменяет узел по `stableKey`, а связь — по комбинации source/target/type. Невидимый или неактивный override подавляет унаследованный узел. Структуры v2 адаптируются в `schemaVersion=2-compat`.

## Selection и pricing

Backend проверяет selectable/visible node, обязательные dynamic fields и связи. `includes` и `included_when_selected` сохраняют дочерний узел как included и исключают его отдельную стоимость даже при прямой передаче обоих slug. `requires`, `excludes`, `alternative_to` и `conditional` нельзя обойти прямым API.

Расчёт двухфазный:

1. Нормализовать выбор и раскрыть included-связи.
2. Найти цену node → parent → root.
3. Определить владельцев пакетов и все covered nodes до построения строк.
4. Построить детерминированные line items и повторить их для каждого визита.

Unpriced node не создаёт ложную точную сумму. Quote содержит selected/included/separately-priced nodes, каждый визит, длительность, итог помощи, фиксированные сервисные сборы и версии всех effective layers.

## Безопасный seed

`npm run db:seed-service-tree-v3` импортирует черновики v3 для РФ, ХМАО и Югорска. Команда не активирует их. Preview, сравнение и ручная публикация обязательны.
