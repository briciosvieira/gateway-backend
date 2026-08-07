import type { Prisma } from '../../../../generated/prisma/client';
import { sanitizeForLog } from './sensitive-data-mask.util';

export function toPrismaJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  try {
    const sanitizedValue = sanitizeForLog(value);
    const serialized = JSON.stringify(sanitizedValue);

    if (serialized === undefined) {
      return undefined;
    }

    return JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}
