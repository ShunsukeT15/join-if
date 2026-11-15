import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpApiClient, sha256Hex } from '../src/api/client';

afterEach(() => vi.unstubAllGlobals());

describe('HttpApiClient', () => {
  it('sends the payload hash for writes (CloudFront OAC) and tokens in headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"roomId":"r","adminToken":"t"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await new HttpApiClient('').createRoom({ title: '式' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/rooms');
    expect(init.headers['x-amz-content-sha256']).toBe(await sha256Hex('{"title":"式"}'));

    await new HttpApiClient('').closeRoom('r', 'ADMIN').catch(() => {});
    const [, init2] = fetchMock.mock.calls[1]!;
    expect(init2.headers['X-Admin-Token']).toBe('ADMIN');
    expect(init2.headers['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('does not send the hash for GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new HttpApiClient('').getAdminView('r', 'A');
    expect(fetchMock.mock.calls[0]![1].headers['x-amz-content-sha256']).toBeUndefined();
  });
});
