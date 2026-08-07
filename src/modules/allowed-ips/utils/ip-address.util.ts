import { BadRequestException } from '@nestjs/common';
import * as ipaddr from 'ipaddr.js';
import { AllowedIpType } from '../../../../generated/prisma/client';

export interface ParsedAllowedIp {
  normalizedAddress: string;
  type: AllowedIpType;
}

export function parseAllowedIpAddress(value: string): ParsedAllowedIp {
  const trimmedValue = value.trim();

  try {
    if (trimmedValue.includes('/')) {
      const [address, prefixLength] = ipaddr.parseCIDR(trimmedValue);
      const isIPv6 = address.kind() === 'ipv6';

      const networkAddress = isIPv6
        ? ipaddr.IPv6.networkAddressFromCIDR(trimmedValue)
        : ipaddr.IPv4.networkAddressFromCIDR(trimmedValue);

      return {
        normalizedAddress: `${networkAddress.toString()}/${prefixLength}`,
        type: isIPv6 ? AllowedIpType.CIDR_IPV6 : AllowedIpType.CIDR_IPV4,
      };
    }

    const parsedAddress = ipaddr.parse(trimmedValue);

    return {
      normalizedAddress: parsedAddress.toString(),
      type: parsedAddress.kind() === 'ipv6' ? AllowedIpType.IPV6 : AllowedIpType.IPV4,
    };
  } catch {
    throw new BadRequestException(
      'The provided IP address or CIDR network is invalid.',
    );
  }
}
