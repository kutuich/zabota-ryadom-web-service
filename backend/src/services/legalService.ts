import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { UserRole } from "../types/domain";
import { HttpError } from "../utils/http";

type DbClient = Prisma.TransactionClient | typeof prisma;

export type LegalRoleScope = "all" | "customer" | "helper" | "admin";

export type LegalDocumentDefinition = {
  type: string;
  roleScope: LegalRoleScope;
  title: string;
  slug: string;
  version: string;
  isRequired: boolean;
  contentMarkdown: string;
};

export type ConsentFeature =
  | "create_request"
  | "edit_request"
  | "publish_request"
  | "respond_to_request"
  | "open_chat"
  | "send_chat_message"
  | "confirm_helper"
  | "accept_work"
  | "complete_request"
  | "leave_review"
  | "top_up_balance"
  | "upload_helper_document"
  | "view_helper_document_status"
  | "create_support_ticket"
  | "admin_view_documents"
  | "admin_export_consents";

export const LEGAL_DOCUMENT_KEYS = [
  "privacy",
  "personal_data_consent",
  "customer_agreement",
  "helper_terms",
  "service_notifications_consent",
  "marketing_notifications_consent",
  "helper_documents_consent",
  "service_rules"
] as const;

export const LEGAL_DOCUMENT_DEFINITIONS: LegalDocumentDefinition[] = [
  {
    type: "privacy",
    roleScope: "all",
    title: "Политика обработки персональных данных",
    slug: "privacy",
    version: "1.0",
    isRequired: true,
    contentMarkdown: `# Политика обработки персональных данных

Редакция 1.0. Документ подготовлен для preview-версии сервиса «Забота Рядом» и требует юридической проверки перед production-запуском.

«Забота Рядом» хранит данные, необходимые для работы локального сервиса помощи: имя, телефон, город, роль, заявки, отклики, обращения, сообщения, статусы документов помощника и операции баланса.

Сервис не является медицинской организацией, социальной службой, государственным учреждением, домом престарелых, кадровым агентством или работодателем помощников. Помощники действуют как самостоятельные лица, а заказчик оплачивает работу помощнику напрямую по согласованным условиям.

Точный адрес заявки скрывается от помощников до согласования условий и перехода заявки в работу. До этого помощник видит только публичный адрес: город и улицу.

Сообщения модерируются для безопасности. Не передавайте телефон, ссылки, данные банковских карт и коды из SMS в чате по заявке. Оригинал скрытых сообщений может быть доступен администратору в режиме разбора нарушения.

Документы помощника доступны администратору для проверки. Заказчик видит только понятные статусы проверки, но не получает файлы документов.
`
  },
  {
    type: "personal_data_consent",
    roleScope: "all",
    title: "Согласие на обработку персональных данных",
    slug: "personal-data-consent",
    version: "1.0",
    isRequired: true,
    contentMarkdown: `# Согласие на обработку персональных данных

Редакция 1.0. Нажимая кнопку принятия согласия, пользователь разрешает сервису «Забота Рядом» обрабатывать персональные данные для регистрации, авторизации, подбора заявок, общения в чате, начисления и списания сервисных сборов, поддержки и безопасности.

Заказчик подтверждает, что у него есть законное основание передавать сервису сведения о человеке, которому нужна помощь, включая возраст, состояние подопечного и бытовые условия заявки.

Сервис не принимает медицинские заявки и не обрабатывает медицинские назначения как часть услуги. Если в заявке указаны инъекции, перевязки, лечение, диагностика или иные медицинские процедуры, заявка может быть отклонена или заблокирована.

Согласие может быть отозвано, но отзыв может ограничить доступ к функциям сервиса, где обработка данных необходима.
`
  },
  {
    type: "customer_agreement",
    roleScope: "customer",
    title: "Пользовательское соглашение заказчика",
    slug: "customer-agreement",
    version: "1.0",
    isRequired: true,
    contentMarkdown: `# Пользовательское соглашение заказчика

Редакция 1.0. Заказчик размещает заявку на бытовую помощь, присмотр, сопровождение, готовку, поручения, прогулки или помощь для семьи и близких.

«Забота Рядом» помогает заказчику найти помощника и организовать безопасное обсуждение условий, но не является работодателем помощника и не гарантирует выполнение неограниченного объёма работ.

Оплата работы помощнику передаётся заказчиком напрямую по согласованной оплате за визит. Сервисный сбор заказчика составляет 50 ₽ за согласованный визит и списывается только после двойного подтверждения условий заказчиком и помощником.

До перехода заявки в работу помощник не видит точный адрес, квартиру, подъезд, этаж, домофон и комментарий к адресу.

Заказчик обязуется не передавать телефон, ссылки, банковские карты и коды из SMS в обход правил сервиса.
`
  },
  {
    type: "helper_terms",
    roleScope: "helper",
    title: "Условия использования сервиса помощником",
    slug: "helper-terms",
    version: "1.0",
    isRequired: true,
    contentMarkdown: `# Условия использования сервиса помощником

Редакция 1.0. Помощник откликается на заявки и самостоятельно принимает решение, подходит ли ему город, график, объём помощи, состояние подопечного и условия визита.

«Забота Рядом» не является работодателем помощника, не оформляет трудоустройство, не обещает гарантированное количество заявок и не поручает медицинские услуги.

Сервисный сбор помощника составляет 50 ₽ за согласованный визит и списывается только после двойного подтверждения условий заказчиком и помощником. Доход помощника после сервисного сбора равен согласованной оплате за визит минус сервисный сбор помощника.

Помощник не должен выполнять инъекции, капельницы, перевязки, диагностику, лечение, медицинский массаж, работу с катетерами, стомами и другие медицинские процедуры.

Точный адрес раскрывается помощнику только после согласования условий и перехода заявки в работу.
`
  },
  {
    type: "service_notifications_consent",
    roleScope: "all",
    title: "Согласие на получение сервисных уведомлений",
    slug: "service-notifications-consent",
    version: "1.0",
    isRequired: true,
    contentMarkdown: `# Согласие на получение сервисных уведомлений

Редакция 1.0. Пользователь соглашается получать уведомления, необходимые для работы сервиса: регистрацию, вход, создание заявки, отклики, открытие чата, изменение условий, двойное подтверждение, списание сервисного сбора, обращения к администратору и сообщения безопасности.

Сервисные уведомления нужны для исполнения пользовательских сценариев и безопасности. Без них часть функций может быть недоступна.
`
  },
  {
    type: "marketing_notifications_consent",
    roleScope: "all",
    title: "Согласие на получение информационных сообщений",
    slug: "marketing-notifications-consent",
    version: "1.0",
    isRequired: false,
    contentMarkdown: `# Согласие на получение информационных сообщений

Редакция 1.0. Пользователь может добровольно согласиться получать новости сервиса, полезные материалы, акции, предложения и информационные сообщения.

Это согласие не является обязательным. Отказ от него не ограничивает регистрацию и основные функции сервиса.
`
  },
  {
    type: "helper_documents_consent",
    roleScope: "helper",
    title: "Согласие на загрузку, хранение и проверку документов помощника",
    slug: "helper-documents-consent",
    version: "1.0",
    isRequired: false,
    contentMarkdown: `# Согласие на загрузку, хранение и проверку документов помощника

Редакция 1.0. Документ обязателен только перед загрузкой файлов помощника: документа о самозанятости или справки об отсутствии судимости.

Помощник соглашается, что администратор сервиса может просмотреть загруженные документы, изменить статус проверки, добавить комментарий и использовать результат проверки для подбора заявок.

Заказчик не получает файлы документов помощника. Заказчик видит только понятные статусы проверки и допуска.
`
  },
  {
    type: "service_rules",
    roleScope: "all",
    title: "Правила сервиса и запрещённые услуги",
    slug: "service-rules",
    version: "1.0",
    isRequired: true,
    contentMarkdown: `# Правила сервиса и запрещённые услуги

Редакция 1.0. Все обсуждения по заявке ведутся внутри сервиса до согласования условий и перехода заявки в работу.

Запрещено передавать телефон, ссылки на мессенджеры, банковские карты, коды из SMS и другие контактные данные в обход сервиса. Сообщение с такими данными скрывается от обычных участников и может быть просмотрено администратором при разборе нарушения.

Сервис не оказывает медицинские услуги. Нельзя публиковать и выполнять заявки на инъекции, капельницы, перевязки, лечение, диагностику, медицинский массаж, работу с катетерами, стомами и иные медицинские процедуры.

Сервисный сбор заказчика 50 ₽ и сервисный сбор помощника 50 ₽ списываются только после двойного подтверждения условий. Открытие чата, отклик и первое сообщение не списывают деньги.
`
  }
];

const REGISTRATION_REQUIRED: Record<"client" | "performer", string[]> = {
  client: ["customer_agreement", "privacy", "personal_data_consent", "service_rules", "service_notifications_consent"],
  performer: [
    "helper_terms",
    "privacy",
    "personal_data_consent",
    "service_rules",
    "helper_documents_consent",
    "service_notifications_consent"
  ]
};

const FEATURE_REQUIRED: Record<ConsentFeature, Partial<Record<"client" | "performer" | "admin", string[]>>> = {
  create_request: { client: REGISTRATION_REQUIRED.client },
  edit_request: { client: REGISTRATION_REQUIRED.client },
  publish_request: { client: REGISTRATION_REQUIRED.client },
  confirm_helper: { client: REGISTRATION_REQUIRED.client },
  top_up_balance: { client: REGISTRATION_REQUIRED.client, performer: REGISTRATION_REQUIRED.performer },
  respond_to_request: { performer: REGISTRATION_REQUIRED.performer },
  open_chat: { client: REGISTRATION_REQUIRED.client },
  send_chat_message: { client: REGISTRATION_REQUIRED.client, performer: REGISTRATION_REQUIRED.performer },
  accept_work: { performer: REGISTRATION_REQUIRED.performer },
  complete_request: { client: REGISTRATION_REQUIRED.client, performer: REGISTRATION_REQUIRED.performer },
  leave_review: { client: REGISTRATION_REQUIRED.client, performer: REGISTRATION_REQUIRED.performer },
  upload_helper_document: {
    performer: [...REGISTRATION_REQUIRED.performer, "helper_documents_consent"]
  },
  view_helper_document_status: { performer: REGISTRATION_REQUIRED.performer },
  create_support_ticket: {},
  admin_view_documents: { admin: [] },
  admin_export_consents: { admin: [] }
};

export function calculateLegalDocumentHash(input: Pick<LegalDocumentDefinition, "title" | "version" | "type" | "contentMarkdown">) {
  return crypto
    .createHash("sha256")
    .update(`${input.title}\n${input.version}\n${input.type}\n${input.contentMarkdown}`)
    .digest("hex");
}

export function roleToLegalScope(role: string): LegalRoleScope {
  if (role === "client") return "customer";
  if (role === "performer") return "helper";
  if (role === "admin" || role === "superadmin") return "admin";
  return "all";
}

export function requiredDocumentTypesForRegistration(role: "client" | "performer") {
  return REGISTRATION_REQUIRED[role];
}

export function requiredDocumentTypesForFeature(role: UserRole, feature: ConsentFeature) {
  if (role === "oauth_pending" || role === "manager") return [];
  const normalizedRole = role === "superadmin" ? "admin" : role;
  return FEATURE_REQUIRED[feature]?.[normalizedRole] ?? [];
}

export function missingAcceptedDocumentTypes(role: "client" | "performer", acceptedTypes: string[]) {
  const accepted = new Set(acceptedTypes);
  return requiredDocumentTypesForRegistration(role).filter((type) => !accepted.has(type));
}

export async function seedLegalDocuments(client: DbClient = prisma, createdByAdminId?: string | null) {
  await ensureLegalDocuments(client, createdByAdminId);
}

export async function ensureLegalDocuments(client: DbClient = prisma, createdByAdminId?: string | null) {
  await migrateLegacyPrivacyDocument(client);

  for (const definition of LEGAL_DOCUMENT_DEFINITIONS) {
    const published = await client.legalDocument.findFirst({
      where: { type: definition.type, isActive: true, isPublished: true },
      orderBy: { publishedAt: "desc" }
    });
    if (published) {
      if (published.isRequired !== definition.isRequired) {
        await client.legalDocument.update({ where: { id: published.id }, data: { isRequired: definition.isRequired } });
      }
      continue;
    }

    const contentHash = calculateLegalDocumentHash(definition);
    const existing = await client.legalDocument.findUnique({
      where: {
        type_version: {
          type: definition.type,
          version: definition.version
        }
      }
    });

    const now = new Date();
    const data = {
      type: definition.type,
      roleScope: definition.roleScope,
      title: definition.title,
      slug: definition.slug,
      version: definition.version,
      contentMarkdown: definition.contentMarkdown,
      contentHash,
      isRequired: definition.isRequired,
      isPublished: true,
      isActive: true,
      publishedAt: now,
      effectiveFrom: now,
      archivedAt: null,
      createdByAdminId: createdByAdminId ?? null
    };

    if (existing) {
      await client.legalDocument.update({
        where: { id: existing.id },
        data: {
          ...data,
          createdByAdminId: existing.createdByAdminId ?? data.createdByAdminId
        }
      });
    } else {
      await client.legalDocument.create({ data });
    }
  }
}

async function migrateLegacyPrivacyDocument(client: DbClient) {
  const current = await client.legalDocument.findUnique({
    where: { type_version: { type: "privacy", version: "1.0" } }
  });
  if (current) return;

  const legacy = await client.legalDocument.findUnique({
    where: { type_version: { type: "privacy_policy", version: "1.0" } }
  });
  if (!legacy) return;

  await client.legalDocument.update({
    where: { id: legacy.id },
    data: { type: "privacy" }
  });
}

export async function getPublishedLegalDocuments(client: DbClient = prisma) {
  const documents = await client.legalDocument.findMany({
    where: { isActive: true, isPublished: true },
    orderBy: [{ roleScope: "asc" }, { isRequired: "desc" }, { title: "asc" }]
  });
  const order = new Map(LEGAL_DOCUMENT_DEFINITIONS.map((document, index) => [document.type, index]));
  return documents.sort((left, right) => (order.get(left.type) ?? 999) - (order.get(right.type) ?? 999));
}

export async function getPublishedLegalDocumentBySlug(slug: string, client: DbClient = prisma) {
  return client.legalDocument.findFirst({
    where: { slug, isActive: true, isPublished: true },
    orderBy: { publishedAt: "desc" }
  });
}

export async function acceptLatestLegalDocuments(params: {
  userId: string;
  documentTypes: string[];
  source: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  adminId?: string | null;
  client?: DbClient;
}) {
  const client = params.client ?? prisma;
  const uniqueTypes = Array.from(new Set(params.documentTypes));
  const documents = await client.legalDocument.findMany({
    where: { type: { in: uniqueTypes }, isActive: true, isPublished: true },
    orderBy: { publishedAt: "desc" }
  });
  const latestByType = new Map<string, (typeof documents)[number]>();
  for (const document of documents) {
    if (!latestByType.has(document.type)) latestByType.set(document.type, document);
  }

  const accepted = [];
  for (const type of uniqueTypes) {
    const document = latestByType.get(type);
    if (!document) {
      throw new HttpError(400, `Юридический документ ${type} не найден`, "legal_document_not_found", { type });
    }
    const existing = await client.userConsent.findUnique({
      where: {
        userId_documentId: {
          userId: params.userId,
          documentId: document.id
        }
      }
    });
    const payload = {
      documentType: document.type,
      documentVersion: document.version,
      documentTitle: document.title,
      documentContentHash: document.contentHash,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      source: params.source,
      isRequired: document.isRequired,
      isActive: true,
      revokedAt: null,
      revocationReason: null,
      acceptedAt: new Date()
    };
    const saved = existing
      ? await client.userConsent.update({
          where: { id: existing.id },
          data: payload
        })
      : await client.userConsent.create({
          data: {
            userId: params.userId,
            documentId: document.id,
            ...payload
          }
        });

    await client.userConsentAuditLog.create({
      data: {
        userId: params.userId,
        adminId: params.adminId ?? null,
        action: existing ? "consent.reaccepted" : "consent.accepted",
        documentType: document.type,
        documentVersion: document.version,
        oldValue: existing ? JSON.stringify({
          documentVersion: existing.documentVersion,
          documentContentHash: existing.documentContentHash,
          isActive: existing.isActive,
          revokedAt: existing.revokedAt
        }) : null,
        newValue: JSON.stringify({
          documentId: document.id,
          documentTitle: document.title,
          documentVersion: document.version,
          documentContentHash: document.contentHash,
          source: params.source
        }),
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        comment: "Принято пользователем"
      }
    });
    accepted.push(saved);
  }
  return accepted;
}

export async function getConsentStatuses(userId: string, role: UserRole, client: DbClient = prisma) {
  const scope = roleToLegalScope(role);
  const documents = await client.legalDocument.findMany({
    where: {
      isActive: true,
      isPublished: true,
      OR: [
        { roleScope: "all" },
        ...(scope === "admin" ? [{ roleScope: "admin" }] : [{ roleScope: scope }])
      ]
    },
    orderBy: [{ isRequired: "desc" }, { title: "asc" }]
  });
  const consents = await client.userConsent.findMany({
    where: { userId, documentType: { in: documents.map((document) => document.type) } },
    orderBy: { acceptedAt: "desc" }
  });

  return documents.map((document) => {
    const current = consents.find((consent) => consent.documentId === document.id && consent.isActive && !consent.revokedAt);
    const anyForType = consents.find((consent) => consent.documentType === document.type);
    const status = current
      ? "accepted"
      : anyForType?.revokedAt
        ? "revoked"
        : anyForType
          ? "needs_new_version"
          : document.isRequired
            ? "required"
            : "optional";

    return {
      document,
      consent: current ?? anyForType ?? null,
      status
    };
  });
}

export async function getMissingConsents(user: { id: string; role: UserRole; realRole?: UserRole; isActingAsRole?: boolean }, feature: ConsentFeature, client: DbClient = prisma) {
  if (user.isActingAsRole && user.realRole && ["admin", "superadmin"].includes(user.realRole)) return [];
  if (user.role === "admin" || user.role === "superadmin") return [];
  const requiredTypes = requiredDocumentTypesForFeature(user.role, feature);
  if (requiredTypes.length === 0) return [];
  const statuses = await getConsentStatuses(user.id, user.role, client);
  return statuses
    .filter((row) => requiredTypes.includes(row.document.type))
    .filter((row) => row.status !== "accepted")
    .map((row) => ({
      type: row.document.type,
      title: row.document.title,
      slug: row.document.slug,
      version: row.document.version,
      status: row.status,
      isRequired: row.document.isRequired
    }));
}

export async function canUseFeature(user: { id: string; role: UserRole }, feature: ConsentFeature, client: DbClient = prisma) {
  const missing = await getMissingConsents(user, feature, client);
  return { allowed: missing.length === 0, missing };
}

export function requireFeatureConsent(feature: ConsentFeature) {
  return async (req: any, _res: any, next: any) => {
    try {
      if (!req.user) {
        return next(new HttpError(401, "Нужна авторизация", "auth_required"));
      }
      const result = await canUseFeature(req.user, feature);
      if (!result.allowed) {
        return next(new HttpError(
          403,
          "Для этого действия нужно принять обязательные юридические документы.",
          "MISSING_REQUIRED_CONSENT",
          { missing: result.missing, feature }
        ));
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export async function publishLegalDocument(documentId: string, adminId: string) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const document = await tx.legalDocument.findUnique({ where: { id: documentId } });
    if (!document) throw new HttpError(404, "Юридический документ не найден", "legal_document_not_found");
    await tx.legalDocument.updateMany({
      where: {
        type: document.type,
        id: { not: document.id },
        isActive: true,
        isPublished: true
      },
      data: {
        isActive: false,
        archivedAt: new Date()
      }
    });
    const published = await tx.legalDocument.update({
      where: { id: document.id },
      data: {
        isPublished: true,
        isActive: true,
        publishedAt: new Date(),
        effectiveFrom: new Date(),
        archivedAt: null
      }
    });
    await tx.userConsentAuditLog.create({
      data: {
        adminId,
        action: "legal_document.published",
        documentType: published.type,
        documentVersion: published.version,
        newValue: JSON.stringify({ documentId: published.id, contentHash: published.contentHash }),
        comment: "Опубликована новая версия юридического документа"
      }
    });
    return published;
  });
}

export async function buildAllConsentsExport(adminId: string, meta: RequestMeta, client: DbClient = prisma) {
  const fileName = `zabota-all-consents-${dateStamp()}.xlsx`;
  const [users, consents, documents, auditLogs, exportLogs] = await Promise.all([
    client.user.findMany({ include: { city: true }, orderBy: { createdAt: "desc" } }),
    client.userConsent.findMany({ include: { user: true, document: true }, orderBy: { acceptedAt: "desc" } }),
    client.legalDocument.findMany({ orderBy: [{ type: "asc" }, { version: "desc" }] }),
    client.userConsentAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    client.consentExportLog.findMany({ orderBy: { exportedAt: "desc" }, take: 200 })
  ]);
  const missingRows = [];
  for (const user of users) {
    if (user.role === "client" || user.role === "performer") {
      const missing = await getMissingConsents({ id: user.id, role: user.role as UserRole }, user.role === "client" ? "create_request" : "respond_to_request", client);
      for (const item of missing) {
        missingRows.push([user.id, user.displayName, roleLabel(user.role), item.title, item.version, item.status]);
      }
    }
  }
  await logConsentExport(adminId, "all_consents_xlsx", fileName, meta, null, client);
  return {
    fileName,
    sheets: [
      {
        name: "Все пользователи",
        rows: [
          ["ID", "Имя", "Роль", "Email", "Телефон", "Город", "Статус"],
          ...users.map((user) => [user.id, user.displayName, roleLabel(user.role), user.email ?? "", user.phone, user.city?.name ?? "", user.status])
        ]
      },
      {
        name: "Все согласия",
        rows: [
          ["Пользователь", "Роль", "Документ", "Тип", "Версия", "Hash", "Принято", "Источник", "Активно", "Отозвано"],
          ...consents.map((consent) => [
            consent.user.displayName,
            roleLabel(consent.user.role),
            consent.documentTitle,
            consent.documentType,
            consent.documentVersion,
            consent.documentContentHash,
            consent.acceptedAt.toISOString(),
            consent.source,
            consent.isActive,
            consent.revokedAt?.toISOString() ?? ""
          ])
        ]
      },
      { name: "Требуется принять", rows: [["ID", "Пользователь", "Роль", "Документ", "Версия", "Статус"], ...missingRows] },
      {
        name: "Версии документов",
        rows: [
          ["Тип", "Название", "Версия", "Hash", "Обязателен", "Опубликован", "Активен", "Дата публикации"],
          ...documents.map((document) => [document.type, document.title, document.version, document.contentHash, document.isRequired, document.isPublished, document.isActive, document.publishedAt?.toISOString() ?? ""])
        ]
      },
      {
        name: "Журнал согласий",
        rows: [["Дата", "Пользователь", "Админ", "Действие", "Тип", "Версия", "Комментарий"], ...auditLogs.map((log) => [log.createdAt.toISOString(), log.userId ?? "", log.adminId ?? "", log.action, log.documentType ?? "", log.documentVersion ?? "", log.comment ?? ""])]
      },
      {
        name: "Журнал экспортов",
        rows: [["Дата", "Админ", "Тип", "Пользователь", "Файл", "Комментарий"], ...exportLogs.map((log) => [log.exportedAt.toISOString(), log.exportedByAdminId ?? "", log.exportType, log.userId ?? "", log.fileName, log.comment ?? ""])]
      }
    ]
  };
}

export async function buildUserConsentsExport(userId: string, adminId: string, meta: RequestMeta, client: DbClient = prisma) {
  const user = await client.user.findUnique({
    where: { id: userId },
    include: { city: true, legalConsents: { include: { document: true }, orderBy: { acceptedAt: "desc" } } }
  });
  if (!user) throw new HttpError(404, "Пользователь не найден", "user_not_found");
  const fileName = `zabota-user-consents-${user.id}-${dateStamp()}.xlsx`;
  const history = await client.userConsentAuditLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  const missing = user.role === "client" || user.role === "performer"
    ? await getMissingConsents({ id: user.id, role: user.role as UserRole }, user.role === "client" ? "create_request" : "respond_to_request", client)
    : [];
  await logConsentExport(adminId, "user_consents_xlsx", fileName, meta, userId, client);
  return {
    fileName,
    sheets: [
      { name: "Пользователь", rows: [["ID", user.id], ["Имя", user.displayName], ["Роль", roleLabel(user.role)], ["Email", user.email ?? ""], ["Телефон", user.phone], ["Город", user.city?.name ?? ""], ["Статус", user.status]] },
      {
        name: "Согласия",
        rows: [
          ["Документ", "Тип", "Версия", "Hash", "Принято", "Источник", "Активно", "Отозвано"],
          ...user.legalConsents.map((consent) => [consent.documentTitle, consent.documentType, consent.documentVersion, consent.documentContentHash, consent.acceptedAt.toISOString(), consent.source, consent.isActive, consent.revokedAt?.toISOString() ?? ""])
        ]
      },
      { name: "История", rows: [["Дата", "Действие", "Тип", "Версия", "Комментарий"], ...history.map((log) => [log.createdAt.toISOString(), log.action, log.documentType ?? "", log.documentVersion ?? "", log.comment ?? ""])] },
      { name: "Ограничения доступа", rows: [["Документ", "Тип", "Версия", "Статус"], ...missing.map((item) => [item.title, item.type, item.version, item.status])] }
    ]
  };
}

export async function buildUserLegalArchiveExport(userId: string, adminId: string, meta: RequestMeta, client: DbClient = prisma) {
  const user = await client.user.findUnique({
    where: { id: userId },
    include: { city: true, legalConsents: { include: { document: true }, orderBy: { acceptedAt: "desc" } } }
  });
  if (!user) throw new HttpError(404, "Пользователь не найден", "user_not_found");
  const fileName = `zabota-user-legal-archive-${user.id}-${dateStamp()}.zip`;
  const [history, exportLogs] = await Promise.all([
    client.userConsentAuditLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    client.consentExportLog.findMany({ where: { userId }, orderBy: { exportedAt: "desc" } })
  ]);
  await logConsentExport(adminId, "user_legal_archive_zip", fileName, meta, userId, client);
  return {
    fileName,
    files: [
      { path: "user.csv", data: csv([["id", "name", "role", "email", "phone", "city", "status"], [user.id, user.displayName, roleLabel(user.role), user.email ?? "", user.phone, user.city?.name ?? "", user.status]]) },
      {
        path: "consents.csv",
        data: csv([
          ["id", "documentType", "documentTitle", "documentVersion", "documentContentHash", "acceptedAt", "source", "isActive", "revokedAt", "ipAddress", "userAgent"],
          ...user.legalConsents.map((consent) => [
            consent.id,
            consent.documentType,
            consent.documentTitle,
            consent.documentVersion,
            consent.documentContentHash,
            consent.acceptedAt.toISOString(),
            consent.source,
            String(consent.isActive),
            consent.revokedAt?.toISOString() ?? "",
            consent.ipAddress ?? "",
            consent.userAgent ?? ""
          ])
        ])
      },
      { path: "consent_audit_log.csv", data: csv([["id", "action", "documentType", "documentVersion", "createdAt", "comment"], ...history.map((log) => [log.id, log.action, log.documentType ?? "", log.documentVersion ?? "", log.createdAt.toISOString(), log.comment ?? ""])]) },
      { path: "export_log.csv", data: csv([["id", "adminId", "exportType", "fileName", "exportedAt", "comment"], ...exportLogs.map((log) => [log.id, log.exportedByAdminId ?? "", log.exportType, log.fileName, log.exportedAt.toISOString(), log.comment ?? ""])]) },
      { path: "metadata.json", data: JSON.stringify({ generatedAt: new Date().toISOString(), generatedByAdminId: adminId, userId, service: "Забота Рядом", version: "preview" }, null, 2) }
    ]
  };
}

export async function buildLegalArchiveExport(adminId: string, meta: RequestMeta, client: DbClient = prisma) {
  const fileName = `zabota-legal-archive-${dateStamp()}.zip`;
  const [users, consents, documents, auditLogs, exportLogs] = await Promise.all([
    client.user.findMany({ include: { city: true }, orderBy: { createdAt: "desc" } }),
    client.userConsent.findMany({ orderBy: { acceptedAt: "desc" } }),
    client.legalDocument.findMany({ orderBy: [{ type: "asc" }, { version: "desc" }] }),
    client.userConsentAuditLog.findMany({ orderBy: { createdAt: "desc" } }),
    client.consentExportLog.findMany({ orderBy: { exportedAt: "desc" } })
  ]);
  await logConsentExport(adminId, "legal_archive_zip", fileName, meta, null, client);
  return {
    fileName,
    files: [
      { path: "users.csv", data: csv([["id", "name", "role", "email", "phone", "city", "status"], ...users.map((user) => [user.id, user.displayName, roleLabel(user.role), user.email ?? "", user.phone, user.city?.name ?? "", user.status])]) },
      { path: "consents.csv", data: csv([["id", "userId", "documentType", "documentVersion", "documentTitle", "contentHash", "acceptedAt", "source", "isActive"], ...consents.map((consent) => [consent.id, consent.userId, consent.documentType, consent.documentVersion, consent.documentTitle, consent.documentContentHash, consent.acceptedAt.toISOString(), consent.source, String(consent.isActive)])]) },
      { path: "legal_documents.csv", data: csv([["id", "type", "title", "slug", "version", "contentHash", "required", "published", "active"], ...documents.map((document) => [document.id, document.type, document.title, document.slug, document.version, document.contentHash, String(document.isRequired), String(document.isPublished), String(document.isActive)])]) },
      { path: "consent_audit_log.csv", data: csv([["id", "userId", "adminId", "action", "documentType", "documentVersion", "createdAt", "comment"], ...auditLogs.map((log) => [log.id, log.userId ?? "", log.adminId ?? "", log.action, log.documentType ?? "", log.documentVersion ?? "", log.createdAt.toISOString(), log.comment ?? ""])]) },
      { path: "export_log.csv", data: csv([["id", "adminId", "exportType", "userId", "fileName", "exportedAt", "comment"], ...exportLogs.map((log) => [log.id, log.exportedByAdminId ?? "", log.exportType, log.userId ?? "", log.fileName, log.exportedAt.toISOString(), log.comment ?? ""])]) },
      { path: "metadata.json", data: JSON.stringify({ generatedAt: new Date().toISOString(), generatedByAdminId: adminId, service: "Забота Рядом", version: "preview" }, null, 2) }
    ]
  };
}

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  comment?: string | null;
};

async function logConsentExport(adminId: string, exportType: string, fileName: string, meta: RequestMeta, userId: string | null, client: DbClient) {
  await client.consentExportLog.create({
    data: {
      exportedByAdminId: adminId,
      exportType,
      userId,
      fileName,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      comment: meta.comment ?? null
    }
  });
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function roleLabel(role: string) {
  if (role === "client") return "Заказчик";
  if (role === "performer") return "Помощник";
  if (role === "superadmin") return "Владелец";
  return "Администратор";
}

function csv(rows: Array<Array<string | number | boolean | null | undefined>>) {
  return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}
