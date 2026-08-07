import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AuditEntity } from '../../../generated/prisma/client';
import type { Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { ChangeTrustedCaStatusDto } from './dto/change-trusted-ca-status.dto';
import type {
  FindTrustedCasQueryDto,
  TrustedCaSortDirection,
  TrustedCaSortField,
} from './dto/find-trusted-cas-query.dto';
import type { CreateTrustedCaUploadInput } from './interfaces/create-trusted-ca-upload.interface';
import { parseTrustedCaCertificate } from './utils/trusted-ca-certificate.util';
import { TrustedCaDispatcherService } from './trusted-ca-dispatcher.service';

const trustedCaPublicSelect = {
  id: true,
  name: true,
  fingerprintSha256: true,
  subject: true,
  issuer: true,
  serialNumber: true,
  validFrom: true,
  validTo: true,
  isRoot: true,
  active: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class TrustedCasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly trustedCaDispatcherService: TrustedCaDispatcherService,
  ) {}

  async create(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    input: CreateTrustedCaUploadInput,
  ) {
    const normalizedName = this.normalizeName(input.name);
    const certificateMetadata = parseTrustedCaCertificate(
      input.filename,
      input.buffer,
    );

    const existingTrustedCa = await this.prisma.trustedCa.findUnique({
      where: {
        fingerprintSha256: certificateMetadata.fingerprintSha256,
      },
      select: {
        id: true,
      },
    });

    if (existingTrustedCa) {
      throw new ConflictException({
        message: 'This trusted CA is already registered.',
        code: 'TRUSTED_CA_ALREADY_EXISTS',
      });
    }

    const trustedCa = await this.prisma.trustedCa.create({
      data: {
        name: normalizedName,
        certificatePem: certificateMetadata.certificatePem,
        fingerprintSha256: certificateMetadata.fingerprintSha256,
        subject: certificateMetadata.subject,
        issuer: certificateMetadata.issuer,
        serialNumber: certificateMetadata.serialNumber,
        validFrom: certificateMetadata.validFrom,
        validTo: certificateMetadata.validTo,
        isRoot: certificateMetadata.isRoot,
        active: true,
        createdById: currentUser.id,
      },
      select: trustedCaPublicSelect,
    });

    await this.trustedCaDispatcherService.invalidateDispatcher();

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.CREATE,
      entity: AuditEntity.TRUSTED_CA,
      entityId: trustedCa.id,
      newValue: this.toAuditValue(trustedCa),
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Trusted CA ${trustedCa.name} was created.`,
    });

    return trustedCa;
  }

  async findAll(query: FindTrustedCasQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.trustedCa.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: trustedCaPublicSelect,
      }),
      this.prisma.trustedCa.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
      filters: {
        search: query.search ?? null,
        active: query.active ?? null,
        validity: query.validity ?? null,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
    };
  }

  async findOne(trustedCaId: string) {
    return this.getTrustedCaOrThrow(trustedCaId);
  }

  async changeStatus(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    trustedCaId: string,
    dto: ChangeTrustedCaStatusDto,
  ) {
    const currentTrustedCa = await this.getTrustedCaOrThrow(trustedCaId);

    if (currentTrustedCa.active === dto.active) {
      return currentTrustedCa;
    }

    const updatedTrustedCa = await this.prisma.trustedCa.update({
      where: {
        id: trustedCaId,
      },
      data: {
        active: dto.active,
      },
      select: trustedCaPublicSelect,
    });

    await this.trustedCaDispatcherService.invalidateDispatcher();

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: dto.active ? AuditAction.ACTIVATE : AuditAction.DEACTIVATE,
      entity: AuditEntity.TRUSTED_CA,
      entityId: updatedTrustedCa.id,
      previousValue: this.toAuditValue(currentTrustedCa),
      newValue: this.toAuditValue(updatedTrustedCa),
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Trusted CA ${updatedTrustedCa.name} was ${
        updatedTrustedCa.active ? 'activated' : 'deactivated'
      }.`,
    });

    return updatedTrustedCa;
  }

  async remove(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    trustedCaId: string,
  ): Promise<void> {
    const trustedCa = await this.getTrustedCaOrThrow(trustedCaId);

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.DELETE,
      entity: AuditEntity.TRUSTED_CA,
      entityId: trustedCa.id,
      previousValue: this.toAuditValue(trustedCa),
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Trusted CA ${trustedCa.name} was deleted.`,
    });

    await this.prisma.trustedCa.delete({
      where: {
        id: trustedCaId,
      },
    });

    await this.trustedCaDispatcherService.invalidateDispatcher();
  }

  private async getTrustedCaOrThrow(trustedCaId: string) {
    const trustedCa = await this.prisma.trustedCa.findUnique({
      where: {
        id: trustedCaId,
      },
      select: trustedCaPublicSelect,
    });

    if (!trustedCa) {
      throw new NotFoundException('Trusted CA was not found.');
    }

    return trustedCa;
  }

  private buildWhere(query: FindTrustedCasQueryDto): Prisma.TrustedCaWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.validity === 'valid'
        ? {
            validTo: {
              gt: new Date(),
            },
          }
        : {}),
      ...(query.validity === 'expired'
        ? {
            validTo: {
              lte: new Date(),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { subject: { contains: search, mode: 'insensitive' } },
              { issuer: { contains: search, mode: 'insensitive' } },
              { serialNumber: { contains: search, mode: 'insensitive' } },
              {
                fingerprintSha256: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };
  }

  private buildOrderBy(
    sortBy: TrustedCaSortField,
    sortOrder: TrustedCaSortDirection,
  ): Prisma.TrustedCaOrderByWithRelationInput {
    const allowedFields: Record<
      TrustedCaSortField,
      Prisma.TrustedCaOrderByWithRelationInput
    > = {
      name: { name: sortOrder },
      validTo: { validTo: sortOrder },
      createdAt: { createdAt: sortOrder },
      updatedAt: { updatedAt: sortOrder },
    };

    return allowedFields[sortBy];
  }

  private normalizeName(value: string): string {
    const normalizedValue = value.trim();

    if (normalizedValue.length < 3 || normalizedValue.length > 120) {
      throw new BadRequestException({
        message: 'Trusted CA name must be between 3 and 120 characters.',
        code: 'INVALID_TRUSTED_CA_NAME',
      });
    }

    return normalizedValue;
  }

  private toAuditValue(
    trustedCa: Pick<
      Prisma.TrustedCaGetPayload<{ select: typeof trustedCaPublicSelect }>,
      | 'id'
      | 'name'
      | 'fingerprintSha256'
      | 'subject'
      | 'issuer'
      | 'serialNumber'
      | 'validFrom'
      | 'validTo'
      | 'isRoot'
      | 'active'
    >,
  ) {
    return {
      id: trustedCa.id,
      name: trustedCa.name,
      fingerprintSha256: trustedCa.fingerprintSha256,
      subject: trustedCa.subject,
      issuer: trustedCa.issuer,
      serialNumber: trustedCa.serialNumber,
      validFrom: trustedCa.validFrom,
      validTo: trustedCa.validTo,
      isRoot: trustedCa.isRoot,
      active: trustedCa.active,
    };
  }
}
