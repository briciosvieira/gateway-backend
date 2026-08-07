import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../generated/prisma/client';
import { CurrentRequestContext } from '../../common/decorators/request-context.decorator';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ClientsService } from './clients.service';
import { ChangeClientStatusDto } from './dto/change-client-status.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { FindClientsQueryDto } from './dto/find-clients-query.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@ApiTags('Clients')
@ApiBearerAuth()
@Controller('clients')
@Roles(RoleCode.ADMIN, RoleCode.OPERATOR, RoleCode.VIEWER, RoleCode.AUDITOR)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Create a client' })
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Body() dto: CreateClientDto,
  ) {
    return this.clientsService.create(currentUser, requestContext, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List clients with pagination and filters' })
  findAll(@Query() query: FindClientsQueryDto) {
    return this.clientsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a client by ID' })
  findOne(@Param('id', ParseUUIDPipe) clientId: string) {
    return this.clientsService.findOne(clientId);
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Update a client' })
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(
      currentUser,
      requestContext,
      clientId,
      dto,
    );
  }

  @Patch(':id/status')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Activate or deactivate a client' })
  changeStatus(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body() dto: ChangeClientStatusDto,
  ) {
    return this.clientsService.changeStatus(
      currentUser,
      requestContext,
      clientId,
      dto,
    );
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN)
  @ApiOperation({
    summary: 'Delete a client',
    description:
      'Only ADMIN. Fails with 409 while the client still has API Keys, Allowed IPs or Gateway Routes.',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) clientId: string,
  ): Promise<void> {
    await this.clientsService.remove(currentUser, requestContext, clientId);
  }
}
