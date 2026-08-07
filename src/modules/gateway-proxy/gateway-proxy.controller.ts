import { Controller, Delete, Get, Patch, Post, Put, Req, Res } from '@nestjs/common';
import { ApiExcludeController, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SkipResponseWrapper } from '../../common/decorators/skip-response-wrapper.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { GatewayProxyService } from './gateway-proxy.service';
import type { GatewayErrorResult } from './interfaces/gateway-error.interface';
import { isGatewayErrorResult } from './interfaces/gateway-error.interface';

const PUBLIC_GATEWAY_DESCRIPTION =
  'Forwards the request to the internal destination configured in the matching Gateway Route. Authenticated exclusively via X-API-Key and the client Allowed IPs — no administrative JWT is accepted here. The response status, body and an allow-listed subset of headers are returned transparently from the internal destination.';

const API_KEY_HEADER_DOC = {
  name: 'X-API-Key',
  required: true,
  description: 'Client API Key, in the format ghlf_<identifier>_<secret>.',
};

@ApiExcludeController()
@ApiTags('Gateway Proxy')
@Controller('gateway')
@Public()
@SkipResponseWrapper()
export class GatewayProxyController {
  constructor(private readonly gatewayProxyService: GatewayProxyService) {}

  @Get('*')
  @ApiOperation({
    summary: 'Public gateway endpoint (GET)',
    description: PUBLIC_GATEWAY_DESCRIPTION,
  })
  @ApiHeader(API_KEY_HEADER_DOC)
  handleGet(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.handle(request, reply);
  }

  @Post('*')
  @ApiOperation({
    summary: 'Public gateway endpoint (POST)',
    description: PUBLIC_GATEWAY_DESCRIPTION,
  })
  @ApiHeader(API_KEY_HEADER_DOC)
  handlePost(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.handle(request, reply);
  }

  @Put('*')
  @ApiOperation({
    summary: 'Public gateway endpoint (PUT)',
    description: PUBLIC_GATEWAY_DESCRIPTION,
  })
  @ApiHeader(API_KEY_HEADER_DOC)
  handlePut(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.handle(request, reply);
  }

  @Patch('*')
  @ApiOperation({
    summary: 'Public gateway endpoint (PATCH)',
    description: PUBLIC_GATEWAY_DESCRIPTION,
  })
  @ApiHeader(API_KEY_HEADER_DOC)
  handlePatch(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.handle(request, reply);
  }

  @Delete('*')
  @ApiOperation({
    summary: 'Public gateway endpoint (DELETE)',
    description: PUBLIC_GATEWAY_DESCRIPTION,
  })
  @ApiHeader(API_KEY_HEADER_DOC)
  handleDelete(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.handle(request, reply);
  }

  private async handle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = await this.gatewayProxyService.handleGatewayRequest(request);

    if (isGatewayErrorResult(result)) {
      this.sendGatewayError(reply, request, result);
      return;
    }

    reply.status(result.statusCode);

    for (const [name, value] of Object.entries(result.headers)) {
      reply.header(name, value);
    }

    reply.send(result.body);
  }

  private sendGatewayError(
    reply: FastifyReply,
    request: FastifyRequest,
    error: GatewayErrorResult,
  ): void {
    if (error.allowedMethods) {
      reply.header('allow', error.allowedMethods);
    }

    const requestId =
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : 'unknown';

    reply.status(error.statusCode).send({
      success: false,
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
