# Импорт и экспорт структур услуг

> Статус: ACTIVE OPERATIONAL DOCUMENT.

## Фактический формат

JSON использует `version`, `scope`, `passport`, `categories`, `taskTemplates`, `safetyRules`, `pricingRules`. Scope можно адресовать через `regionId/regionSlug` или `cityId/citySlug`. Excel содержит листы «Паспорт структуры», «Категории», «Типовые задачи», «Ограничения», «Рекомендуемые цены», «Инструкция».

`passport.versionNumber` принимает `v2.0`, `2.0`, `v2.0.1` или `10.12.3`; в БД сохраняется строка без `v`. Архивирование не освобождает номер. После физического удаления никогда не публиковавшейся версии без зависимостей номер можно использовать повторно; для обычного исправления предпочтительна patch-версия.

Task contract включает `taskKind`, `aliases`, `durationEffect`, `priceEffect`, `requiresComment`, `allowedRegions`, `formFields`, `recommendations` и `constraints`. Pricing rule может содержать `taskSlug`, `packageCode` и `coveredTaskSlugs`. Safety rule использует стабильный `ruleKey`, `isBlocking` и optional `applicability`: `appliesToTaskSlugs`, `appliesToCategorySlugs`, `conditions`, `forbiddenValues`, `numericLimits`, `requiredConfirmation`. Готовые expanded visits не экспортируются: они принадлежат заявке, а не структуре.

## Безопасный импорт

1. Выберите JSON/XLSX до 5 МБ.
2. Выполните preview и исправьте errors/warnings.
3. Создайте draft.
4. Сравните draft с действующей версией.
5. Проверьте направления, задачи, динамические поля, ограничения и цены.
6. Активируйте отдельным admin-действием.

Импорт никогда не редактирует active и не публикует автоматически. Повтор payload блокируется SHA-256 `importHash`. Документ со старыми публичными направлениями может быть импортирован только как draft и не должен публиковаться без ручной проверки.

## Validation

- `slug` lower-kebab-case и уникален;
- parent/category references существуют;
- task/pricing/recommendation references существуют;
- типы динамических полей и options валидны;
- `min <= max`, цены неотрицательны;
- status/severity/boolean значения валидны;
- блокирующее правило без машиночитаемого условия отклоняется;
- старое информационное правило без `ruleKey` получает стабильный ключ из title и остаётся совместимым;
- запрещённые публичные и опасные формулировки отклоняются или отмечаются warning;
- preview показывает counts, errors и warnings.

После публикации новая заявка использует rules effective structure по [REQUEST_CALCULATOR.md](REQUEST_CALCULATOR.md). Старые snapshots сохраняют прежнюю версию.

## Минимальный пример динамического поля

```json
{
  "scope": { "type": "city", "citySlug": "yugorsk" },
  "passport": { "versionNumber": "2.1", "title": "Структура услуг Югорска" },
  "categories": [
    { "slug": "accompaniment", "title": "Сопровождение" },
    { "slug": "accompaniment-standard", "parentSlug": "accompaniment", "title": "Сопроводить" }
  ],
  "taskTemplates": [{
    "categorySlug": "accompaniment-standard",
    "taskSlug": "accompany",
    "title": "Сопроводить",
    "formFields": [{ "id": "destination", "label": "Куда нужно сопроводить?", "type": "text", "required": true }]
  }]
}
```
# Schema v3

JSON/XLSX schema v3 импортирует узлы, связи, node pricing и node safety. XLSX-листы: «Узлы», «Связи узлов», «Цены узлов», «Ограничения узлов». `npm run db:seed-service-tree-v3` создаёт только черновики и не активирует их.
