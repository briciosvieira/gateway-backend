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
import type { ChangeClientStatusDto } from './dto/change-client-status.dto';
import type { CreateClientDto } from './dto/create-client.dto';
import type {
  ClientSortField,
  FindClientsQueryDto,
  SortDirection,
} from './dto/find-clients-query.dto';
import type { UpdateClientDto } from './dto/update-client.dto';
import { generateClientCode } from './utils/client-code.util';

const clientSelect = {
  id: true,
  name: true,
  code: true,
  description: true,
  contactName: true,
  contactEmail: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    dto: CreateClientDto,
  ) {
    const normalizedName = dto.name.trim();
    const generatedCode = generateClientCode(normalizedName);

    if (!generatedCode) {
      throw new BadRequestException(
        'Unable to generate a client identifier from the provided name. Use at least one letter or number.',
      );
    }

    const normalizedContactEmail = this.normalizeOptionalEmail(
      dto.contactEmail,
    );

    const existingClient = await this.prisma.client.findUnique({
      where: {
        code: generatedCode,
      },
    });

    if (existingClient) {
      throw new ConflictException({
        message:
          'A client with this identifier already exists. Choose a different name.',
        code: 'CLIENT_CODE_ALREADY_EXISTS',
      });
    }

    const client = await this.prisma.client.create({
      data: {
        name: normalizedName,
        code: generatedCode,
        description: this.normalizeOptionalText(dto.description),
        contactName: this.normalizeOptionalText(dto.contactName),
        contactEmail: normalizedContactEmail,
        active: true,
      },
      select: clientSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.CREATE,
      entity: AuditEntity.CLIENT,
      entityId: client.id,
      newValue: {
        name: client.name,
        code: client.code,
        description: client.description,
        contactName: client.contactName,
        contactEmail: client.contactEmail,
        active: client.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Client ${client.code} was created.`,
    });

    return client;
  }

  async findAll(query: FindClientsQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: clientSelect,
      }),
      this.prisma.client.count({
        where,
      }),
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
        name: query.name ?? null,
        code: query.code ?? null,
        contactName: query.contactName ?? null,
        contactEmail: query.contactEmail ?? null,
        active: query.active ?? null,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
    };
  }

  async findOne(clientId: string) {
    return this.getClientOrThrow(clientId);
  }

  async update(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    clientId: string,
    dto: UpdateClientDto,
  ) {
    const currentClient = await this.getClientOrThrow(clientId);

    // The identifier ("code") is generated once at creation and never changes on
    // update — it may already be referenced by external integrations, so keeping
    // it stable avoids silently breaking them when only the display name changes.
    const updatedClient = await this.prisma.client.update({
      where: {
        id: clientId,
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: this.normalizeOptionalText(dto.description) }
          : {}),
        ...(dto.contactName !== undefined
          ? { contactName: this.normalizeOptionalText(dto.contactName) }
          : {}),
        ...(dto.contactEmail !== undefined
          ? { contactEmail: this.normalizeOptionalEmail(dto.contactEmail) }
          : {}),
      },
      select: clientSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.UPDATE,
      entity: AuditEntity.CLIENT,
      entityId: updatedClient.id,
      previousValue: {
        name: currentClient.name,
        code: currentClient.code,
        description: currentClient.description,
        contactName: currentClient.contactName,
        contactEmail: currentClient.contactEmail,
        active: currentClient.active,
      },
      newValue: {
        name: updatedClient.name,
        code: updatedClient.code,
        description: updatedClient.description,
        contactName: updatedClient.contactName,
        contactEmail: updatedClient.contactEmail,
        active: updatedClient.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Client ${updatedClient.code} was updated.`,
    });

    return updatedClient;
  }

  async changeStatus(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    clientId: string,
    dto: ChangeClientStatusDto,
  ) {
    const currentClient = await this.getClientOrThrow(clientId);

    if (currentClient.active === dto.active) {
      return currentClient;
    }

    const updatedClient = await this.prisma.client.update({
      where: {
        id: clientId,
      },
      data: {
        active: dto.active,
      },
      select: clientSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: dto.active ? AuditAction.ACTIVATE : AuditAction.DEACTIVATE,
      entity: AuditEntity.CLIENT,
      entityId: updatedClient.id,
      previousValue: {
        active: currentClient.active,
      },
      newValue: {
        active: updatedClient.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Client ${updatedClient.code} was ${
        updatedClient.active ? 'activated' : 'deactivated'
      }.`,
    });

    return updatedClient;
  }

  async remove(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    clientId: string,
  ): Promise<void> {
    const client = await this.getClientOrThrow(clientId);

    const [apiKeyCount, allowedIpCount, gatewayRouteCount] = await Promise.all([
      this.prisma.apiKey.count({ where: { clientId } }),
      this.prisma.allowedIp.count({ where: { clientId } }),
      this.prisma.gatewayRoute.count({ where: { clientId } }),
    ]);

    if (apiKeyCount > 0 || allowedIpCount > 0 || gatewayRouteCount > 0) {
      throw new ConflictException({
        message:
          'Client cannot be deleted while API Keys, Allowed IPs or Gateway Routes still reference it. Remove those first.',
        code: 'CLIENT_HAS_DEPENDENCIES',
      });
    }

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.DELETE,
      entity: AuditEntity.CLIENT,
      entityId: client.id,
      previousValue: {
        name: client.name,
        code: client.code,
        active: client.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Client ${client.code} was deleted.`,
    });

    // Request Logs referencing this client survive (RequestLog.client is
    // onDelete: SetNull) — nothing further to do here to preserve them.
    await this.prisma.client.delete({ where: { id: clientId } });
  }

  private async getClientOrThrow(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: {
        id: clientId,
      },
      select: clientSelect,
    });

    if (!client) {
      throw new NotFoundException('Client was not found.');
    }

    return client;
  }

  private buildWhere(query: FindClientsQueryDto): Prisma.ClientWhereInput {
    const search = query.search?.trim();
    const name = query.name?.trim();
    const code = query.code?.trim();
    const contactName = query.contactName?.trim();
    const contactEmail = query.contactEmail?.trim();

    return {
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(name ? { name: { contains: name, mode: 'insensitive' } } : {}),
      ...(code ? { code: { contains: code, mode: 'insensitive' } } : {}),
      ...(contactName
        ? { contactName: { contains: contactName, mode: 'insensitive' } }
        : {}),
      ...(contactEmail
        ? { contactEmail: { contains: contactEmail, mode: 'insensitive' } }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
              { contactName: { contains: search, mode: 'insensitive' } },
              { contactEmail: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private buildOrderBy(
    sortBy: ClientSortField,
    sortOrder: SortDirection,
  ): Prisma.ClientOrderByWithRelationInput {
    const allowedFields: Record<
      ClientSortField,
      Prisma.ClientOrderByWithRelationInput
    > = {
      name: { name: sortOrder },
      code: { code: sortOrder },
      createdAt: { createdAt: sortOrder },
      updatedAt: { updatedAt: sortOrder },
    };

    return allowedFields[sortBy];
  }

  private normalizeOptionalText(value: string | undefined): string | null {
    if (value === undefined) {
      return null;
    }

    const normalizedValue = value.trim();

    return normalizedValue.length > 0 ? normalizedValue : null;
  }

  private normalizeOptionalEmail(value: string | undefined): string | null {
    if (value === undefined) {
      return null;
    }

    const normalizedValue = value.trim().toLowerCase();

    return normalizedValue.length > 0 ? normalizedValue : null;
  }
}
