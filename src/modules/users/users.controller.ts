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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../generated/prisma/client';
import { CurrentRequestContext } from '../../common/decorators/request-context.decorator';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ChangePasswordRequirementDto } from './dto/src/modules/users/dto/change-password-requirement.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { ChangeUserStatusDto } from './dto/change-user-status.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Create a user' })
  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext()
    requestContext: RequestContext,
    @Body() dto: CreateUserDto,
  ) {
    return this.usersService.create(currentUser, requestContext, dto);
  }

  @ApiOperation({ summary: 'List users visible to the current user' })
  @Get()
  findAll(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.usersService.findAll(currentUser);
  }

  @ApiOperation({ summary: 'Get a user by ID' })
  @Get(':id')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) userId: string,
  ) {
    return this.usersService.findOne(currentUser, userId);
  }

  @ApiOperation({ summary: 'Update a user' })
  @Patch(':id')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext()
    requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(currentUser, requestContext, userId, dto);
  }

  @ApiOperation({ summary: "Change a user's role" })
  @Patch(':id/role')
  changeRole(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext()
    requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: ChangeUserRoleDto,
  ) {
    return this.usersService.changeRole(
      currentUser,
      requestContext,
      userId,
      dto,
    );
  }

  @ApiOperation({ summary: 'Activate or deactivate a user' })
  @Patch(':id/status')
  changeStatus(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext()
    requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: ChangeUserStatusDto,
  ) {
    return this.usersService.changeStatus(
      currentUser,
      requestContext,
      userId,
      dto,
    );
  }

  @ApiOperation({ summary: "Reset a user's password to a new temporary password" })
  @Post(':id/reset-password')
  resetPassword(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext()
    requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) userId: string,
  ) {
    return this.usersService.resetPassword(currentUser, requestContext, userId);
  }

  @ApiOperation({ summary: 'Change whether a user must change their password on next login' })
  @Patch(':id/password-requirement')
  changePasswordRequirement(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext()
    requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: ChangePasswordRequirementDto,
  ) {
    return this.usersService.changePasswordRequirement(
      currentUser,
      requestContext,
      userId,
      dto.requirePasswordChange,
    );
  }

  @ApiOperation({
    summary: 'Delete a user',
    description:
      'Only ADMIN. A user cannot delete themselves, and the last active administrator cannot be deleted.',
  })
  @Delete(':id')
  @Roles(RoleCode.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext()
    requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.usersService.remove(currentUser, requestContext, userId);
  }
}
