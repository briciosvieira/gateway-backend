import * as ipaddr from 'ipaddr.js';
import type { AllowedIpType } from '../../../../generated/prisma/client';

export interface AllowedIpEntry {
  address: string;
  type: AllowedIpType;
}

export function sourceIpMatchesAllowedIp(sourceIp: string, allowedIp: AllowedIpEntry): boolean {
  try {
    if (allowedIp.type === 'IPV4' || allowedIp.type === 'IPV6') {
      return sourceIp === allowedIp.address;
    }

    const [network, prefixLength] = ipaddr.parseCIDR(allowedIp.address);
    const parsedSourceIp = ipaddr.parse(sourceIp);

    if (parsedSourceIp.kind() !== network.kind()) {
      return false;
    }

    return parsedSourceIp.match(network, prefixLength);
  } catch {
    return false;
  }
}
