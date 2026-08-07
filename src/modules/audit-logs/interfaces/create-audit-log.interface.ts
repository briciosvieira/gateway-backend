import type {
  AuditAction,
  AuditEntity,
  Prisma,
} from '../../../../generated/prisma/client';

export interface CreateAuditLogInput {
  userId?: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  previousValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  sourceIp?: string | null;
  requestId?: string | null;
  description?: string | null;
}
