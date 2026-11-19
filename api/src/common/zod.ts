import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';

/** Validates and parses request input with a zod schema; returns German error messages. */
export class ZodPipe<S extends z.ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    const r = this.schema.safeParse(value);
    if (!r.success)
      throw new BadRequestException({
        message: 'Ungültige Eingabe',
        issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    return r.data;
  }
}

type JsonSchema = Record<string, unknown>;
const toJson = (s: z.ZodTypeAny) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as JsonSchema;

/** OpenAPI body documentation derived from the zod schema. */
export const ZodBody = (schema: z.ZodTypeAny) => ApiBody({ schema: toJson(schema) as never });

/** OpenAPI query documentation for each property of a zod object. */
export function ZodQuery(schema: z.ZodObject<z.ZodRawShape>): MethodDecorator {
  const decorators = Object.entries(schema.shape).map(([name, s]) =>
    ApiQuery({
      name,
      required: !(s as z.ZodTypeAny).safeParse(undefined).success,
      schema: toJson(s as z.ZodTypeAny) as never,
    }),
  );
  return (target, key, desc) => {
    for (const d of decorators) d(target, key, desc);
  };
}

export const uuidParam = z.string().uuid();
