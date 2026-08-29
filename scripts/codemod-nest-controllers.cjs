const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");

const directory = path.resolve("backend/src/nest/domains/controllers");
const prefixes = {
  accountSecurityRouter: "api/me",
  temporaryPasswordRouter: "api/auth",
  adminRouter: "api/admin",
  agreementContractsRouter: "api/agreement-contracts",
  authRouter: "api/auth",
  balanceRouter: "api/balance",
  categoryStructuresRouter: "api/category-structures",
  categoriesRouter: "api/categories",
  helperCategoryPreferencesRouter: "api/helper/category-preferences",
  adminCategoryStructuresRouter: "api/admin/category-structures",
  chatsRouter: "api/chats",
  complaintsRouter: "api/complaints",
  knowledgeRouter: "api/knowledge",
  legalRouter: "api/legal",
  managerRouter: "api/manager",
  meCitiesRouter: "api/me/cities",
  npdRegisterRouter: "api/admin/npd-register",
  paymentsRouter: "api/payments",
  adminPaymentsRouter: "api/admin/payments",
  performerDocumentsRouter: "api/performer-documents",
  performerProfileRouter: "api/performer-profile",
  pricingRouter: "api/pricing",
  publicRouter: "api/public",
  requestDraftsRouter: "api/me/request-drafts",
  requestDraftSupportRouter: "api/admin/request-support-cases",
  requestsRouter: "api/requests",
  adminServiceConversationsRouter: "api/admin/service-conversations",
  adminBroadcastsRouter: "api/admin/broadcasts",
  meServiceMessagesRouter: "api/me/service-messages",
  serviceMessageAttachmentsRouter: "api/service-message-attachments",
  paymentServiceMessagesRouter: "api/admin/payments",
  settlementsRouter: "api/settlements",
  visitsRouter: "api/visits",
  adminVisitsRouter: "api/admin/visits"
};
const methodDecorator = { get: "Get", post: "Post", patch: "Patch", put: "Put", delete: "Delete" };
const files = fs.readdirSync(directory).filter((file) => file.endsWith(".ts")).sort();
const allControllers = [];

for (const file of files) {
  const fullPath = path.join(directory, file);
  let source = fs.readFileSync(fullPath, "utf8");
  const sourceFile = ts.createSourceFile(fullPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routers = [];
  const removals = [];
  const uses = new Map();
  const routes = new Map();

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name)
          && declaration.initializer
          && ts.isCallExpression(declaration.initializer)
          && declaration.initializer.expression.getText(sourceFile) === "Router"
        ) {
          routers.push(declaration.name.text);
          removals.push([statement.getFullStart(), statement.end]);
        }
      }
    }
    if (
      !ts.isExpressionStatement(statement)
      || !ts.isCallExpression(statement.expression)
      || !ts.isPropertyAccessExpression(statement.expression.expression)
    ) continue;

    const call = statement.expression;
    const router = call.expression.expression.getText(sourceFile);
    const verb = call.expression.name.text;
    if (!routers.includes(router)) continue;

    if (verb === "use") {
      let routePrefix = null;
      let middlewareStart = 0;
      if (call.arguments[0] && ts.isStringLiteral(call.arguments[0])) {
        routePrefix = call.arguments[0].text;
        middlewareStart = 1;
      }
      const middleware = call.arguments.slice(middlewareStart).map((argument) => argument.getText(sourceFile));
      if (!uses.has(router)) uses.set(router, []);
      uses.get(router).push({ routePrefix, middleware });
      removals.push([statement.getFullStart(), statement.end]);
      continue;
    }

    if (!methodDecorator[verb]) continue;
    const args = [...call.arguments];
    if (!args.length || !ts.isStringLiteral(args[0])) throw new Error(`${file}: route path must be a string literal`);
    let handler = args.at(-1);
    if (ts.isCallExpression(handler) && handler.expression.getText(sourceFile) === "asyncHandler") {
      handler = handler.arguments[0];
    }
    if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) {
      throw new Error(`${file}: unsupported route handler ${handler.getText(sourceFile).slice(0, 100)}`);
    }
    const routeMiddleware = args.slice(1, -1).map((argument) => argument.getText(sourceFile));
    const inheritedMiddleware = (uses.get(router) ?? [])
      .filter((entry) => !entry.routePrefix || args[0].text.startsWith(entry.routePrefix))
      .flatMap((entry) => entry.middleware);
    if (!routes.has(router)) routes.set(router, []);
    routes.get(router).push({
      verb,
      pathNode: args[0],
      handler,
      middleware: [...inheritedMiddleware, ...routeMiddleware]
    });
    removals.push([statement.getFullStart(), statement.end]);
  }

  if (!routers.length) throw new Error(`${file}: no Router declarations found`);
  const controllerClasses = [];
  for (const router of routers) {
    if (!prefixes[router]) throw new Error(`${file}: missing controller prefix for ${router}`);
    const className = `${router.replace(/Router$/, "").replace(/^./, (character) => character.toUpperCase())}Controller`;
    allControllers.push({ file: file.replace(/\.ts$/, ".controller.ts"), className, router });
    const methods = [];
    let routeIndex = 0;
    for (const route of routes.get(router) ?? []) {
      const decorators = [`  @${methodDecorator[route.verb]}(${route.pathNode.getText(sourceFile)})`];
      const guards = [];
      let roles = null;
      for (const rawMiddleware of route.middleware) {
        const middleware = rawMiddleware.replace(/\s+/g, "");
        if (middleware === "authenticate") guards.push("NestJwtAuthGuard");
        else if (middleware === "requireAdmin") guards.push("NestAdminGuard");
        else if (middleware === "requireAdminManagerOrSuperadmin") guards.push("NestAdminManagerGuard");
        else if (/^requireRole\(/.test(middleware)) {
          guards.push("NestRolesGuard");
          roles = rawMiddleware.slice(rawMiddleware.indexOf("(") + 1, rawMiddleware.lastIndexOf(")"));
        } else if (/^requireFeatureConsent\(/.test(middleware)) {
          const feature = rawMiddleware.slice(rawMiddleware.indexOf("(") + 1, rawMiddleware.lastIndexOf(")"));
          guards.push(`NestFeatureConsentGuard(${feature})`);
        } else {
          throw new Error(`${file}: unknown route middleware ${rawMiddleware}`);
        }
      }
      if (roles) decorators.push(`  @RequireRoles(${roles})`);
      const uniqueGuards = [...new Set(guards)];
      if (uniqueGuards.length) decorators.push(`  @UseGuards(${uniqueGuards.join(", ")})`);

      const parameters = route.handler.parameters;
      if (
        parameters.length < 2
        || !ts.isIdentifier(parameters[0].name)
        || !ts.isIdentifier(parameters[1].name)
      ) throw new Error(`${file}: unsupported route handler parameters`);
      const requestName = parameters[0].name.text;
      const responseName = parameters[1].name.text;
      const isAsync = route.handler.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
      const body = ts.isBlock(route.handler.body)
        ? route.handler.body.getText(sourceFile)
        : `{\n    return ${route.handler.body.getText(sourceFile)};\n  }`;
      const pathName = route.pathNode.text
        .replace(/[^a-zA-Z0-9]+(.)?/g, (_match, character) => character ? character.toUpperCase() : "")
        .replace(/^$/, "root")
        .replace(/^(.)/, (character) => character.toLowerCase());
      const methodName = `${route.verb}${pathName}${routeIndex++}`;
      methods.push(
        `${decorators.join("\n")}\n  ${isAsync ? "async " : ""}${methodName}(@Req() ${requestName}: Request, @Res() ${responseName}: Response) ${body}`
      );
    }
    controllerClasses.push(
      `@Controller("${prefixes[router]}")\nexport class ${className} {\n${methods.join("\n\n")}\n}`
    );
  }

  for (const [start, end] of removals.sort((left, right) => right[0] - left[0])) {
    source = source.slice(0, start) + source.slice(end);
  }
  source = source
    .replace('import { Router } from "express";', 'import type { Request, Response } from "express";')
    .replace('import { Router, type Request, type Response } from "express";', 'import type { Request, Response } from "express";')
    .replace('import { Router, type Response } from "express";', 'import type { Request, Response } from "express";');
  if (!source.includes('import type { Request, Response } from "express";')) {
    source = `import type { Request, Response } from "express";\n${source}`;
  }
  source = source.replace(/from "\.\.\//g, 'from "../../../');
  source = [
    'import { Controller, Delete, Get, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";',
    'import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";',
    source.trim(),
    controllerClasses.join("\n\n"),
    ""
  ].join("\n");
  const outputPath = path.join(directory, file.replace(/\.ts$/, ".controller.ts"));
  fs.writeFileSync(outputPath, source);
  if (outputPath !== fullPath) fs.unlinkSync(fullPath);
}

fs.writeFileSync("/tmp/nest-controller-classes.json", JSON.stringify(allControllers, null, 2));
console.log(`Converted ${files.length} files into ${allControllers.length} NestJS controllers.`);
