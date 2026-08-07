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
import { ChangeRouteHeaderStatusDto } from './dto/change-route-header-status.dto';
import { CreateRouteHeaderDto } from './dto/create-route-header.dto';
import { FindRouteHeadersQueryDto } from './dto/find-route-headers-query.dto';
import { UpdateRouteHeaderDto } from './dto/update-route-header.dto';
import { RouteHeadersService } from './route-headers.service';

@ApiTags('Route Headers')
@ApiBearerAuth()
@Controller('route-headers')
@Roles(RoleCode.ADMIN, RoleCode.OPERATOR, RoleCode.VIEWER, RoleCode.AUDITOR)
export class RouteHeadersController {
  constructor(private readonly routeHeadersService: RouteHeadersService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Create a header for a gateway route' })
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Body() dto: CreateRouteHeaderDto,
  ) {
    return this.routeHeadersService.create(currentUser, requestContext, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List route headers with pagination and filters' })
  findAll(@Query() query: FindRouteHeadersQueryDto) {
    return this.routeHeadersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a route header by ID' })
  findOne(@Param('id', ParseUUIDPipe) routeHeaderId: string) {
    return this.routeHeadersService.findOne(routeHeaderId);
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Update a route header' })
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) routeHeaderId: string,
    @Body() dto: UpdateRouteHeaderDto,
  ) {
    return this.routeHeadersService.update(
      currentUser,
      requestContext,
      routeHeaderId,
      dto,
    );
  }

  @Patch(':id/status')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Activate or deactivate a route header' })
  changeStatus(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) routeHeaderId: string,
    @Body() dto: ChangeRouteHeaderStatusDto,
  ) {
    return this.routeHeadersService.changeStatus(
      currentUser,
      requestContext,
      routeHeaderId,
      dto,
    );
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN)
  @ApiOperation({ summary: 'Delete a route header' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) routeHeaderId: string,
  ): Promise<void> {
    await this.routeHeadersService.remove(
      currentUser,
      requestContext,
      routeHeaderId,
    );
  }
}
