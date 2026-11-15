/**
 * The APNs sender, against a local HTTP/2 server standing in for Apple's: what
 * a request looks like, that its provider token really is signed by the key,
 * and what each of Apple's answers does to the device token.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http2 from 'http2';
import { generateKeyPairSync, verify as cryptoVerify, type KeyObject } from 'crypto';
import type { AddressInfo } from 'net';
import {
  buildApnsPayload,
  buildApnsProviderToken,
  createApnsSender,
  isApnsDeviceToken,
  type ApnsSender,
} from './apnsService';

const DEVICE = 'a1b2c3d4'.repeat(8);
const OTHER_DEVICE = '0f'.repeat(32);

interface Seen {
  host: 'production' | 'sandbox';
  path: string;
  headers: http2.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

/** One stand-in APNs host. `answer` decides the status and reason per request. */
function fakeApns(host: Seen['host'], seen: Seen[], answer: (s: Seen) => { status: number; reason?: string }) {
  const server = http2.createServer();
  server.on('stream', (stream, headers) => {
    let raw = '';
    stream.setEncoding('utf8');
    stream.on('data', (c: string) => { raw += c; });
    stream.on('end', () => {
      const s: Seen = { host, path: String(headers[':path']), headers, body: JSON.parse(raw || '{}') };
      seen.push(s);
      const { status, reason } = answer(s);
      stream.respond({ ':status': status, 'content-type': 'application/json' });
      stream.end(status === 200 ? '' : JSON.stringify({ reason }));
    });
  });
  return server;
}

describe('the APNs sender', () => {
  let privatePem: string;
  let publicKey: KeyObject;
  let production: http2.Http2Server;
  let sandbox: http2.Http2Server;
  let sender: ApnsSender;
  const seen: Seen[] = [];
  let answerProduction: (s: Seen) => { status: number; reason?: string };
  let answerSandbox: (s: Seen) => { status: number; reason?: string };
  let clock = 1_800_000_000_000;

  const listen = (server: http2.Http2Server) =>
    new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

  beforeAll(async () => {
    // What Apple issues as a .p8: a P-256 private key, PKCS#8, PEM.
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    publicKey = pair.publicKey;
    production = fakeApns('production', seen, (s) => answerProduction(s));
    sandbox = fakeApns('sandbox', seen, (s) => answerSandbox(s));
    const [productionOrigin, sandboxOrigin] = await Promise.all([listen(production), listen(sandbox)]);
    sender = createApnsSender({
      keyPem: privatePem,
      keyId: 'KEYID12345',
      teamId: 'TEAMID1234',
      bundleId: 'com.borderfall.app',
      productionOrigin,
      sandboxOrigin,
      now: () => clock,
    });
  });

  afterAll(async () => {
    sender?.close();
    await Promise.all([production, sandbox].map((s) => new Promise((r) => s.close(() => r(null)))));
  });

  beforeEach(() => {
    seen.length = 0;
    answerProduction = () => ({ status: 200 });
    answerSandbox = () => ({ status: 200 });
  });

  const turn = { title: "It's your turn!", body: 'Ancient Era, turn 4.', data: { type: 'your_turn', gameId: 'g1' }, collapseId: 'turn-g1' };

  it('addresses the device and the app, and is delivered', async () => {
    expect(await sender.send(DEVICE, turn)).toEqual({ status: 'sent', environment: 'production' });
    expect(seen).toHaveLength(1);
    expect(seen[0].host).toBe('production');
    expect(seen[0].path).toBe(`/3/device/${DEVICE}`);
    expect(seen[0].headers[':method']).toBe('POST');
    expect(seen[0].headers['apns-topic']).toBe('com.borderfall.app');
    expect(seen[0].headers['apns-push-type']).toBe('alert');
    expect(seen[0].headers['apns-priority']).toBe('10');
    expect(seen[0].headers['apns-collapse-id']).toBe('turn-g1');
  });

  it('carries the alert, and the game it is about beside it for the app to open', async () => {
    await sender.send(DEVICE, turn);
    expect(seen[0].body).toEqual({
      type: 'your_turn',
      gameId: 'g1',
      aps: { alert: { title: "It's your turn!", body: 'Ancient Era, turn 4.' }, sound: 'default', 'thread-id': 'turn-g1' },
    });
  });

  it('proves who it is with a token the .p8 key really signed', async () => {
    await sender.send(DEVICE, turn);
    const [scheme, jwt] = String(seen[0].headers.authorization).split(' ');
    expect(scheme).toBe('bearer');
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEYID12345' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ iss: 'TEAMID1234', iat: Math.floor(clock / 1000) });
    // The raw r||s form JWS requires: 64 bytes for P-256. A DER signature would be ~70 and Apple refuses it.
    expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
    expect(cryptoVerify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('reuses its provider token, and signs a new one before Apple would call it stale', async () => {
    await sender.send(DEVICE, turn);
    clock += 10 * 60 * 1000;
    await sender.send(DEVICE, turn);
    expect(seen[1].headers.authorization).toBe(seen[0].headers.authorization);
    clock += 45 * 60 * 1000;
    await sender.send(DEVICE, turn);
    expect(seen[2].headers.authorization).not.toBe(seen[0].headers.authorization);
  });

  it('signs a new token and tries again when Apple says the token has expired', async () => {
    let calls = 0;
    answerProduction = () => (calls++ === 0 ? { status: 403, reason: 'ExpiredProviderToken' } : { status: 200 });
    expect(await sender.send(DEVICE, turn)).toEqual({ status: 'sent', environment: 'production' });
    expect(seen).toHaveLength(2);
  });

  // A build run from Xcode gets a sandbox token; nothing in the token says so.
  it('finds a development build\'s token on the sandbox, and goes straight there next time', async () => {
    answerProduction = () => ({ status: 400, reason: 'BadDeviceToken' });
    expect(await sender.send(OTHER_DEVICE, turn)).toEqual({ status: 'sent', environment: 'sandbox' });
    expect(seen.map((s) => s.host)).toEqual(['production', 'sandbox']);
    seen.length = 0;
    expect(await sender.send(OTHER_DEVICE, turn)).toEqual({ status: 'sent', environment: 'sandbox' });
    expect(seen.map((s) => s.host)).toEqual(['sandbox']);
  });

  it('calls a token gone when the app was removed', async () => {
    answerProduction = () => ({ status: 410, reason: 'Unregistered' });
    expect(await sender.send(DEVICE, turn)).toEqual({ status: 'gone', reason: 'Unregistered' });
    expect(seen.map((s) => s.host)).toEqual(['production']);
  });

  it('calls a token gone when neither environment knows it, or it is another app\'s', async () => {
    answerProduction = () => ({ status: 400, reason: 'BadDeviceToken' });
    answerSandbox = () => ({ status: 400, reason: 'BadDeviceToken' });
    expect(await sender.send(DEVICE, turn)).toEqual({ status: 'gone', reason: 'BadDeviceToken' });
    answerProduction = () => ({ status: 400, reason: 'DeviceTokenNotForTopic' });
    expect(await sender.send(DEVICE, turn)).toEqual({ status: 'gone', reason: 'DeviceTokenNotForTopic' });
  });

  it('never sends something that is not an APNs token, such as a Firebase one', async () => {
    expect(await sender.send('fcm-registration-token:APA91b...', turn)).toEqual({ status: 'gone', reason: 'NotADeviceToken' });
    expect(seen).toHaveLength(0);
    expect(isApnsDeviceToken(DEVICE)).toBe(true);
    expect(isApnsDeviceToken('../../3/device/x')).toBe(false);
  });

  it('keeps the token when the failure is Apple\'s or ours, not the device\'s', async () => {
    for (const [status, reason] of [[429, 'TooManyRequests'], [500, 'InternalServerError'], [503, 'ServiceUnavailable'], [403, 'InvalidProviderToken'], [400, 'TopicDisallowed']] as const) {
      answerProduction = () => ({ status, reason });
      expect(await sender.send(DEVICE, turn), reason).toEqual({ status: 'failed', reason });
    }
  });

  it('reports an unreachable Apple as a failure, not as a dead token', async () => {
    const unreachable = createApnsSender({
      keyPem: privatePem, keyId: 'K', teamId: 'T', bundleId: 'com.borderfall.app',
      productionOrigin: 'http://127.0.0.1:1', sandboxOrigin: 'http://127.0.0.1:1',
    });
    const res = await unreachable.send(DEVICE, turn);
    expect(res.status).toBe('failed');
    unreachable.close();
  });
});

describe('the pieces', () => {
  it('builds a three-part token', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwt = buildApnsProviderToken(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'KID', 'TEAM', 1_800_000_000);
    expect(jwt.split('.')).toHaveLength(3);
  });

  it('leaves out what a notification does not have', () => {
    expect(buildApnsPayload({ title: 'Test', body: 'Hello' })).toEqual({
      aps: { alert: { title: 'Test', body: 'Hello' }, sound: 'default' },
    });
  });
});
