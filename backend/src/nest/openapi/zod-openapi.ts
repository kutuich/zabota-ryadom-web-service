import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiResponse } from "@nestjs/swagger";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function zodToOpenApiSchema(schema: ZodType<unknown>): SchemaObject {
  const convert = zodToJsonSchema as unknown as (
    input: ZodType<unknown>,
    options: { target: "openApi3"; $refStrategy: "none" }
  ) => Record<string, unknown>;
  const converted = convert(schema, { target: "openApi3", $refStrategy: "none" });
  const { $schema: _schema, definitions: _definitions, ...openApiSchema } = converted;
  return openApiSchema as SchemaObject;
}

export function ApiZodBody(schema: ZodType<unknown>, description = "JSON request validated by the runtime Zod contract") {
  return applyDecorators(ApiBody({ description, schema: zodToOpenApiSchema(schema) }));
}

export function ApiZodResponse(status: number, schema: ZodType<unknown>, description: string) {
  return applyDecorators(ApiResponse({ status, description, schema: zodToOpenApiSchema(schema) }));
}
