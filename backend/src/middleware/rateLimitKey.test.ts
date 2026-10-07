/**
 * Who a rate-limit bucket belongs to: a signed-in user by their id, anyone else
 * by their address, with an IPv6 address counted by its /64.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { userOrIpKey } from './rateLimitKey';
import { signAccessToken } from '../utils/jwt';

function req(ip: string | undefined, authorization?: string): FastifyRequest {
  return { ip, headers: authorization ? { authorization } : {} } as unknown as FastifyRequest;
}

describe('userOrIpKey', () => {
  it('keys a signed-in request by its user, whatever its address', () => {
    const token = signAccessToken({ sub: 'user-1', username: 'commander' });
    expect(userOrIpKey(req('203.0.113.7', `Bearer ${token}`))).toBe('u:user-1');
    expect(userOrIpKey(req('2001:db8:aa:1::5', `Bearer ${token}`))).toBe('u:user-1');
  });

  it('keys by address when the token does not verify', () => {
    expect(userOrIpKey(req('203.0.113.7', 'Bearer not-a-token'))).toBe('ip:203.0.113.7');
  });

  it('keys an IPv4 visitor by its address', () => {
    expect(userOrIpKey(req('203.0.113.7'))).toBe('ip:203.0.113.7');
    expect(userOrIpKey(req('198.51.100.23'))).toBe('ip:198.51.100.23');
  });

  it('counts IPv6 visitors in one /64 as one, and another /64 apart', () => {
    const home = userOrIpKey(req('2001:db8:aa:1:1111:2222:3333:4444'));
    expect(home).toBe('ip:2001:db8:aa:1::');
    expect(userOrIpKey(req('2001:db8:aa:1::9'))).toBe(home);
    expect(userOrIpKey(req('2001:db8:aa:2::9'))).not.toBe(home);
  });

  it('reads an IPv6 address the same however it is written', () => {
    expect(userOrIpKey(req('2001:DB8:AA:1:0:0:0:1'))).toBe(userOrIpKey(req('2001:db8:aa:1::1')));
  });

  it('counts an IPv4-mapped address as its IPv4 one', () => {
    expect(userOrIpKey(req('::ffff:203.0.113.7'))).toBe('ip:203.0.113.7');
  });

  it('keys a request with no address as before', () => {
    expect(userOrIpKey(req(undefined))).toBe('ip:undefined');
  });
});
