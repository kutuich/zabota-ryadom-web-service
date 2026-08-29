import { BadRequestException, Injectable, type ArgumentMetadata, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

export function createZodDto<T>(schema: ZodType<T>) {
  return class ZodDto {
    static readonly schema = schema;
  };
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    const schema = (metadata.metatype as { schema?: ZodType<unknown> } | undefined)?.schema;
    if (!schema) return value;
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      error: "Проверьте заполнение формы",
      code: "validation_error",
      details: {
        validationErrors: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      }
    });
  }
}
