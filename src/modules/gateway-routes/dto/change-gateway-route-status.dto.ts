import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ChangeGatewayRouteStatusDto {
  @ApiProperty({
    example: true,
  })
  @IsBoolean()
  active!: boolean;
}
