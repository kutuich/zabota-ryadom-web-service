# Миграция backend HTTP ownership на NestJS

> Статус: ACTIVE TECHNICAL DOCUMENT  
> Актуализировано: 2026-08-21

Документ фиксирует фактическое состояние framework migration. Продуктовые правила и целевая архитектура остаются в Notion.

## Текущее состояние

Runtime HTTP ownership полностью перенесён в NestJS:

- `backend/src/index.ts` запускает только Nest application;
- 220 ранее Express-owned API endpoints зарегистрированы 34 Nest controller surfaces в 11 domain modules;
- `/api/health`, static frontend/landing delivery и protected `/uploads` fallback также принадлежат NestJS;
- `legacy-express.bridge.ts`, 23 legacy router files, `app.ts` и Express auth middleware удалены;
- duplicate method + URL registrations нет; integration test проверяет 221 API route registrations с учётом health;
- NestJS продолжает использоват Express HTTP adapter. Это не legacy router architecture.

Authentication в HTTP pipeline выполняют Nest guards. JWT, acting-role, VK OAuth, audit, idempotency, payment providers и domain services не перепроектировывались. Router-level Zod schemas сохранены в controllers с прежними границами валидации; общий `ZodValidationPipe` остаётся для DTO-oriented controllers.

## Domain ownership

| NestJS module | Controller surfaces |
|---|---|
| `PublicModule` | public, settlements, pricing, knowledge |
| `AuthModule` | auth, account security, temporary password |
| `LegalModule` | legal |
| `UsersModule` | me cities, performer profile, manager |
| `CatalogModule` | category structures, categories, helper preferences, admin category structures |
| `RequestsModule` | requests, request drafts, complaints, request support |
| `AgreementsModule` | chats, agreement contracts, visits, admin visits |
| `FinanceModule` | balance, NPD register |
| `PaymentsModule` | payments, admin payments |
| `CommunicationsModule` | service conversations, broadcasts, service messages and attachments |
| `FilesModule` | performer documents and protected downloads |
| `AdminModule` | admin and cross-domain admin surfaces |

## Route inventory: Express before → NestJS after

Ниже полный inventory 220 legacy routes. Каждая строка означает ownership из одноимённого Express router до удаления файла и текущий Nest controller.

- `accountSecurity.ts` → `AccountSecurityController` (4): `GET /api/me/profile`, `PATCH /api/me/profile`, `POST /api/me/change-password`, `POST /api/me/sessions/revoke-others`; → `TemporaryPasswordController` (1): `POST /api/auth/change-temporary-password`.
- `admin.ts` → `AdminController` (56): `POST /api/admin/acting/start`, `POST /api/admin/acting/stop`, `PATCH /api/admin/requests/:id/category`, `GET /api/admin/summary`, `GET /api/admin/users`, `POST /api/admin/users/:id/block`, `POST /api/admin/users/:id/unblock`, `POST /api/admin/users/:id/manager/assign`, `POST /api/admin/users/:id/manager/revoke`, `POST /api/admin/users/:id/reset-password`, `POST /api/admin/users/:id/revoke-sessions`, `DELETE /api/admin/users/:id`, `POST /api/admin/users/:id/oauth-pending/cancel`, `GET /api/admin/users/:id/oauth-pending-restore-safety`, `POST /api/admin/users/:id/restore-oauth-pending`, `GET /api/admin/users/:id/archive-safety`, `POST /api/admin/users/:id/request-archive`, `POST /api/admin/users/:id/archive`, `POST /api/admin/users/:id/bonus`, `POST /api/admin/users/:id/balance-adjustment`, `PATCH /api/admin/performers/:userId/verification`, `GET /api/admin/requests`, `PATCH /api/admin/requests/:id/moderation`, `GET /api/admin/chats`, `GET /api/admin/complaints`, `GET /api/admin/cities`, `POST /api/admin/cities`, `PATCH /api/admin/cities/:id`, `GET /api/admin/categories`, `POST /api/admin/categories`, `GET /api/admin/settings`, `GET /api/admin/trial-balance/settings`, `PUT /api/admin/trial-balance/settings`, `POST /api/admin/trial-balance/grant-all`, `PATCH /api/admin/settings/:key`, `GET /api/admin/knowledge`, `POST /api/admin/knowledge`, `PATCH /api/admin/knowledge/:id`, `PATCH /api/admin/performer-documents/:id/status`, `POST /api/admin/archive/run`, `PATCH /api/admin/categories/:id`, `GET /api/admin/balance-transactions`, `GET /api/admin/legal/documents`, `POST /api/admin/legal/documents`, `POST /api/admin/legal/documents/:id/new-version`, `PATCH /api/admin/legal/documents/:id`, `POST /api/admin/legal/documents/:id/publish`, `POST /api/admin/legal/documents/:id/archive`, `GET /api/admin/legal/consents`, `GET /api/admin/legal/export-logs`, `GET /api/admin/legal/exports/all.xlsx`, `GET /api/admin/legal/exports/archive.zip`, `GET /api/admin/users/:userId/legal/consents`, `GET /api/admin/users/:userId/legal/consents.xlsx`, `GET /api/admin/users/:userId/legal/archive.zip`, `GET /api/admin/legal/security-checklist`.
- `agreementContracts.ts` → `AgreementContractsController` (2): `GET /api/agreement-contracts/:id`, `GET /api/agreement-contracts/:id/download`.
- `auth.ts` → `AuthController` (9): `GET /api/auth/oauth/vk/start`, `POST /api/auth/oauth/vk/start`, `GET /api/auth/oauth/vk/callback`, `POST /api/auth/oauth/session`, `POST /api/auth/oauth/cancel`, `POST /api/auth/oauth/complete-profile`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`.
- `balance.ts` → `BalanceController` (2): `GET /api/balance/me`, `POST /api/balance/mock-top-up`.
- `categoryStructures.ts` → `CategoryStructuresController` (3): `GET /api/category-structures/effective-tree`, `GET /api/category-structures/effective`, `POST /api/category-structures/request-updates/:id/confirm`; → `CategoriesController` (2): `GET /api/categories/for-request`, `GET /api/categories/for-helper`; → `HelperCategoryPreferencesController` (2): `GET /api/helper/category-preferences`, `PUT /api/helper/category-preferences`; → `AdminCategoryStructuresController` (22): `GET /api/admin/category-structures/city-status`, `GET /api/admin/category-structures/city-template/export.xlsx`, `GET /api/admin/category-structures/region-template/export.xlsx`, `POST /api/admin/category-structures/import/preview`, `POST /api/admin/category-structures/import/create-draft`, `POST /api/admin/category-structures/create-from-parent`, `GET /api/admin/category-structures`, `GET /api/admin/category-structures/compare`, `GET /api/admin/category-structures/:id/export.xlsx`, `GET /api/admin/category-structures/:id/export.json`, `GET /api/admin/category-structures/:id/dependencies`, `DELETE /api/admin/category-structures/:id`, `POST /api/admin/category-structures/:id/emergency-disable`, `GET /api/admin/category-structures/:id/emergency-disable-preview`, `POST /api/admin/category-structures/:id/requests/:requestId/start-update`, `POST /api/admin/category-structures/request-updates/:id/cancel`, `GET /api/admin/category-structures/:id`, `POST /api/admin/category-structures/:id/new-version`, `POST /api/admin/category-structures/:id/rollback`, `PATCH /api/admin/category-structures/:id`, `POST /api/admin/category-structures/:id/publish`, `POST /api/admin/category-structures/:id/archive`.
- `chats.ts` → `ChatsController` (9): `GET /api/chats`, `GET /api/chats/:id/messages`, `POST /api/chats/:id/messages`, `DELETE /api/chats/:chatId/messages/:messageId`, `PATCH /api/chats/:id/terms`, `POST /api/chats/:id/client-confirm`, `POST /api/chats/:id/performer-confirm`, `POST /api/chats/:id/not-agreed`, `POST /api/chats/:id/propose-new-terms`.
- `complaints.ts` → `ComplaintsController` (3): `GET /api/complaints`, `POST /api/complaints`, `PATCH /api/complaints/:id/resolve`.
- `knowledge.ts` → `KnowledgeController` (1): `GET /api/knowledge`.
- `legal.ts` → `LegalController` (19): `GET /api/legal/documents`, `GET /api/legal/documents/:slug`, `GET /api/legal/me/status`, `GET /api/legal/my-consents`, `POST /api/legal/consents/accept`, `POST /api/legal/consents/revoke-optional`, `GET /api/legal/admin/documents`, `POST /api/legal/admin/documents`, `PATCH /api/legal/admin/documents/:id`, `POST /api/legal/admin/documents/:id/new-version`, `POST /api/legal/admin/documents/:id/publish`, `POST /api/legal/admin/documents/:id/archive`, `GET /api/legal/admin/consents`, `GET /api/legal/admin/users/:id/consents`, `POST /api/legal/admin/exports/all-consents`, `POST /api/legal/admin/users/:id/export-consents`, `POST /api/legal/admin/users/:id/export-archive`, `POST /api/legal/admin/exports/legal-archive`, `GET /api/legal/admin/security-checklist`.
- `manager.ts` → `ManagerController` (15): `GET /api/manager/summary`, `GET /api/manager/users`, `GET /api/manager/users/:id`, `POST /api/manager/users/:id/block`, `POST /api/manager/users/:id/unblock`, `GET /api/manager/requests`, `POST /api/manager/requests`, `GET /api/manager/requests/:id`, `PATCH /api/manager/requests/:id/category`, `GET /api/manager/chats`, `GET /api/manager/chats/:id`, `GET /api/manager/complaints`, `GET /api/manager/complaints/:id`, `GET /api/manager/payments`, `GET /api/manager/balance-transactions`.
- `meCities.ts` → `MeCitiesController` (4): `GET /api/me/cities`, `POST /api/me/cities`, `PATCH /api/me/cities/:id`, `DELETE /api/me/cities/:id`.
- `npdRegister.ts` → `NpdRegisterController` (2): `GET /api/admin/npd-register`, `PATCH /api/admin/npd-register/:id`.
- `payments.ts` → `PaymentsController` (7): `POST /api/payments/top-up/init`, `GET /api/payments/my`, `POST /api/payments/:id/refresh-status`, `POST /api/payments/mock/:id/succeed`, `POST /api/payments/mock/:id/fail`, `POST /api/payments/tbank/webhook`, `GET /api/payments/:id`; → `AdminPaymentsController` (5): `GET /api/admin/payments`, `POST /api/admin/payments/:id/refund`, `POST /api/admin/payments/:id/manual-bank-refund`, `POST /api/admin/payments/:id/sync-tbank-status`, `GET /api/admin/payments/:id`.
- `performerDocuments.ts` → `PerformerDocumentsController` (3): `GET /api/performer-documents`, `POST /api/performer-documents`, `GET /api/performer-documents/:id/download`.
- `performerProfile.ts` → `PerformerProfileController` (1): `PATCH /api/performer-profile/me`.
- `pricing.ts` → `PricingController` (1): `POST /api/pricing/quote`.
- `public.ts` → `PublicController` (1): `GET /api/public/bootstrap`.
- `requestDrafts.ts` → `RequestDraftsController` (9): `GET /api/me/request-drafts`, `POST /api/me/request-drafts`, `GET /api/me/request-drafts/:id`, `PATCH /api/me/request-drafts/:id`, `DELETE /api/me/request-drafts/:id`, `POST /api/me/request-drafts/:id/duplicate`, `POST /api/me/request-drafts/:id/publish`, `POST /api/me/request-drafts/:id/support-cases`, `GET /api/me/request-drafts/:id/support-cases`; → `RequestDraftSupportController` (4): `GET /api/admin/request-support-cases`, `POST /api/admin/request-support-cases/:id/messages`, `PATCH /api/admin/request-support-cases/:id/status`, `POST /api/admin/request-support-cases/:id/assign`.
- `requests.ts` → `RequestsController` (10): `POST /api/requests/calculate-price`, `GET /api/requests`, `POST /api/requests`, `GET /api/requests/:id`, `PATCH /api/requests/:id`, `POST /api/requests/:id/publish`, `POST /api/requests/:id/respond`, `POST /api/requests/responses/:responseId/accept`, `POST /api/requests/:id/complete`, `POST /api/requests/:id/reviews`.
- `serviceCommunications.ts` → `AdminServiceConversationsController` (4): `GET /api/admin/service-conversations`, `GET /api/admin/service-conversations/users/search`, `GET /api/admin/service-conversations/:userId`, `POST /api/admin/service-conversations/:userId/messages`; → `AdminBroadcastsController` (7): `GET /api/admin/broadcasts`, `POST /api/admin/broadcasts/preview`, `POST /api/admin/broadcasts`, `POST /api/admin/broadcasts/:id/send`, `POST /api/admin/broadcasts/:id/cancel`, `GET /api/admin/broadcasts/:id/recipients`, `GET /api/admin/broadcasts/:id`; → `MeServiceMessagesController` (3): `GET /api/me/service-messages`, `GET /api/me/service-messages/:id`, `POST /api/me/service-messages/:id/read`; → `ServiceMessageAttachmentsController` (1): `GET /api/service-message-attachments/:id/download`; → `PaymentServiceMessagesController` (1): `POST /api/admin/payments/:id/message-user`.
- `settlements.ts` → `SettlementsController` (2): `GET /api/settlements/search`, `POST /api/settlements/suggest`.
- `visits.ts` → `VisitsController` (2): `GET /api/visits/request/:requestId`, `POST /api/visits/:visitId/disputes`; → `AdminVisitsController` (3): `GET /api/admin/visits/reserve-summary`, `POST /api/admin/visits/reconcile`, `POST /api/admin/visits/disputes/:id/resolve`.

## Parity and verification

Characterization baseline остаётся обязательным. Nest integration coverage проверяет health, legal, login, authenticated balance, admin/file guards, disabled VK path, route count, duplicate routes и scheduler lifecycle. PostgreSQL smoke проверяет registration/login, legal bootstrap/read/status, auth and role guards, catalog, balance, request publish, helper response, chat terms, double confirmation, `in_work`, mock payment и protected file denial.

API parity deviations в framework migration не вводились. T-Bank smoke не вызывается: все локальные payment scenarios используют `PAYMENT_PROVIDER=mock`.
