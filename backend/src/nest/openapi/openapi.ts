import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod, type INestApplication } from "@nestjs/common";
import { ModulesContainer } from "@nestjs/core";
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject
} from "@nestjs/swagger";
import type {
  OperationObject,
  ParameterObject,
  ResponseObject,
  SchemaObject
} from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { NestJwtAuthGuard } from "../common/auth.guards";

const API_ERROR_SCHEMA: SchemaObject = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
    code: { type: "string", nullable: true },
    details: { nullable: true }
  },
  additionalProperties: true
};

const JSON_VALUE_SCHEMA: SchemaObject = {
  oneOf: [
    { type: "object", additionalProperties: true },
    { type: "array", items: {} },
    { type: "string" },
    { type: "number" },
    { type: "boolean" }
  ]
};

type ControllerRoute = {
  method: string;
  path: string;
  handler: Function;
  protected: boolean;
  controllerName: string;
  status: number;
  authMode: "public" | "bearer-jwt" | "refresh-cookie";
};

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Забота Рядом HTTP API")
    .setDescription("Actual NestJS REST/JSON contract. Current URLs remain intentionally unversioned.")
    .setVersion("stage4")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "bearerAuth")
    .addCookieAuth("zabota_refresh", {
      type: "apiKey",
      in: "cookie",
      name: "zabota_refresh",
      description: "Rotating HttpOnly refresh-session cookie. Production uses the __Host-zabota_refresh name."
    }, "refreshSession")
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}`
  });

  for (const path of Object.keys(document.paths)) {
    if (!path.startsWith("/api/")) delete document.paths[path];
  }

  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ApiError: API_ERROR_SCHEMA,
    JsonValue: JSON_VALUE_SCHEMA
  };

  for (const route of collectControllerRoutes(app)) {
    const pathItem = document.paths[route.path];
    const operation = pathItem?.[route.method.toLowerCase() as keyof typeof pathItem] as OperationObject | undefined;
    if (!operation) continue;
    enrichOperation(operation, route);
  }
  return document;
}

export function exposeOpenApi(
  app: INestApplication,
  document: OpenAPIObject,
  options: { jsonEnabled: boolean; uiEnabled: boolean }
) {
  if (!options.jsonEnabled && !options.uiEnabled) return;
  SwaggerModule.setup("api/docs", app, document, {
    ui: options.uiEnabled,
    raw: options.jsonEnabled ? ["json"] : false,
    jsonDocumentUrl: "/api/openapi.json",
    customSiteTitle: "Забота Рядом API",
    swaggerOptions: { persistAuthorization: false }
  });
}

export function documentedApiOperations(document: OpenAPIObject) {
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem ?? {})
      .filter(([method]) => ["get", "post", "put", "patch", "delete", "options", "head"].includes(method))
      .map(([method, operation]) => ({ method: method.toUpperCase(), path, operation: operation as OperationObject }))
  );
}

function collectControllerRoutes(app: INestApplication): ControllerRoute[] {
  const modules = app.get(ModulesContainer);
  const routes: ControllerRoute[] = [];
  for (const moduleRef of modules.values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | undefined;
      if (!controller) continue;
      const controllerPaths = metadataPaths(Reflect.getMetadata(PATH_METADATA, controller));
      for (const methodName of Object.getOwnPropertyNames(controller.prototype)) {
        if (methodName === "constructor") continue;
        const handler = controller.prototype[methodName as keyof typeof controller.prototype];
        if (typeof handler !== "function") continue;
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (requestMethod === undefined) continue;
        const methodPaths = metadataPaths(Reflect.getMetadata(PATH_METADATA, handler));
        const guards = [
          ...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []),
          ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])
        ];
        const isProtected = guards.some((guard: unknown) => guard === NestJwtAuthGuard || guardName(guard) === NestJwtAuthGuard.name);
        for (const controllerPath of controllerPaths) {
          for (const methodPath of methodPaths) {
            const path = openApiPath(joinPaths(controllerPath, methodPath));
            const authMode = ["/api/auth/refresh", "/api/auth/logout"].includes(path)
              ? "refresh-cookie"
              : isProtected ? "bearer-jwt" : "public";
            routes.push({
              method: RequestMethod[requestMethod],
              path,
              handler,
              protected: isProtected,
              controllerName: controller.name.replace(/Controller$/, ""),
              status: successStatus(handler, requestMethod),
              authMode
            });
          }
        }
      }
    }
  }
  return routes;
}

function enrichOperation(operation: OperationObject, route: ControllerRoute) {
  const extendedOperation = operation as OperationObject & Record<string, unknown>;
  operation.tags = operation.tags?.length ? operation.tags : [route.controllerName];
  operation.summary ??= `${route.method} ${route.path}`;
  operation.security = route.authMode === "bearer-jwt"
    ? [{ bearerAuth: [] }]
    : route.authMode === "refresh-cookie" ? [{ refreshSession: [] }] : [];
  extendedOperation["x-authentication"] = route.authMode;

  const source = route.handler.toString();
  const parameters = [...(operation.parameters ?? [])] as ParameterObject[];
  for (const name of pathParameterNames(route.path)) {
    if (!parameters.some((parameter) => "$ref" in parameter ? false : parameter.in === "path" && parameter.name === name)) {
      parameters.push({ name, in: "path", required: true, schema: { type: "string" } });
    }
  }
  for (const name of queryParameterNames(source)) {
    if (!parameters.some((parameter) => "$ref" in parameter ? false : parameter.in === "query" && parameter.name === name)) {
      parameters.push({
        name,
        in: "query",
        required: false,
        schema: ["limit", "take"].includes(name) ? { type: "integer" } : { type: "string" }
      });
    }
  }
  if (parameters.length) operation.parameters = parameters;

  if (source.includes("req.body") && !operation.requestBody) {
    operation.requestBody = {
      required: !source.includes("req.body ?? {}"),
      description: "JSON body validated by the endpoint's runtime Zod schema",
      content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
    };
    extendedOperation["x-schema-precision"] = "runtime-zod-generic-openapi";
  }

  const existingResponses = operation.responses ?? {};
  for (const status of Object.keys(existingResponses)) {
    if ((/^2\d\d$/.test(status) && status !== String(route.status)) || status === "default") delete existingResponses[status];
  }
  const documentedSuccess = existingResponses[String(route.status)] as ResponseObject | undefined;
  if (!documentedSuccess?.content || Object.keys(documentedSuccess.content).length === 0) {
    existingResponses[String(route.status)] = successResponse(source, route.status);
  }
  if (source.includes("req.body") || source.includes("req.query")) existingResponses["400"] ??= errorResponse("Invalid request data");
  if (route.authMode !== "public") {
    existingResponses["401"] ??= errorResponse("Authentication required");
  }
  if (route.protected) {
    existingResponses["403"] ??= errorResponse("Insufficient permissions or missing required consent");
  }
  if (route.path.includes("{")) existingResponses["404"] ??= errorResponse("Resource not found");
  for (const status of errorStatusCodes(source)) {
    existingResponses[String(status)] ??= errorResponse(`HTTP ${status} error`);
  }
  existingResponses["500"] ??= errorResponse("Internal server error");
  operation.responses = existingResponses;
}

function errorStatusCodes(source: string) {
  return [...source.matchAll(/(?:HttpError|res\.status)\((4\d\d|5\d\d)\)/g)]
    .map((match) => Number(match[1]));
}

function successResponse(source: string, status: number): ResponseObject {
  if (status === 204) return { description: "Successful response with no body" };
  if (status === 302 || source.includes("res.redirect")) {
    return {
      description: "Redirect",
      headers: { Location: { description: "Redirect target", schema: { type: "string", format: "uri" } } }
    };
  }
  if (source.includes("res.download")) {
    return {
      description: "Protected binary file",
      headers: { "Content-Disposition": { schema: { type: "string" } } },
      content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } }
    };
  }
  if (source.includes("text/plain")) {
    return { description: "Plain-text provider acknowledgement", content: { "text/plain": { schema: { type: "string" } } } };
  }
  return {
    description: "Successful JSON response",
    content: { "application/json": { schema: { $ref: "#/components/schemas/JsonValue" } } }
  };
}

function errorResponse(description: string): ResponseObject {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } }
  };
}

function successStatus(handler: Function, requestMethod: RequestMethod) {
  const source = handler.toString();
  if (source.includes("res.redirect")) return 302;
  const explicit = source.match(/res\.status\((2\d\d)\)/)?.[1];
  if (explicit) return Number(explicit);
  return Reflect.getMetadata(HTTP_CODE_METADATA, handler) ?? (requestMethod === RequestMethod.POST ? 201 : 200);
}

function metadataPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [value === undefined ? "" : String(value)];
}

function joinPaths(controllerPath: string, methodPath: string) {
  return `/${controllerPath}/${methodPath}`.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
}

function openApiPath(path: string) {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function pathParameterNames(path: string) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function queryParameterNames(source: string) {
  const names = new Set([...source.matchAll(/req\.query\.([A-Za-z0-9_]+)/g)].map((match) => match[1]));
  for (const match of source.matchAll(/z\.object\(\{([\s\S]*?)\}\)\.parse\(req\.query\)/g)) {
    for (const property of match[1].matchAll(/(?:^|[,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) names.add(property[1]);
  }
  return [...names].sort();
}

function guardName(guard: unknown) {
  if (typeof guard === "function") return guard.name;
  if (guard && typeof guard === "object" && "constructor" in guard) return guard.constructor.name;
  return "";
}
