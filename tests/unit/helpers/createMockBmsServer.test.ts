import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockBmsServer, type MockBmsServer } from '../../helpers/createMockBmsServer';

let server: MockBmsServer;

beforeEach(async () => {
  server = await createMockBmsServer();
});

afterEach(async () => {
  await server.close();
});

describe('createMockBmsServer', () => {
  it('returns a 127.0.0.1 url with a port', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('POST /api/sql returns canned data when SQL matches a registered substring', async () => {
    server.setSqlResponse('FROM ward', [{ ward: '03', name: 'ห้องคลอด' }]);
    const r = await fetch(`${server.url}/api/sql`, {
      method: 'POST',
      headers: { Authorization: 'Bearer X', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT * FROM ward WHERE ...', app: 'KK' }),
    });
    const body = await r.json();
    expect(body.MessageCode).toBe(200);
    expect(body.data).toEqual([{ ward: '03', name: 'ห้องคลอด' }]);
  });

  it('POST /api/sql returns empty data when no match', async () => {
    const r = await fetch(`${server.url}/api/sql`, {
      method: 'POST',
      headers: { Authorization: 'Bearer X', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });
    const body = await r.json();
    expect(body.data).toEqual([]);
  });

  it('POST /api/function?name=X returns registered Value', async () => {
    server.setFunctionResponse('get_serialnumber', 42);
    const r = await fetch(`${server.url}/api/function?name=get_serialnumber`, {
      method: 'POST',
      headers: { Authorization: 'Bearer X', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_field: 'iptbedmove_id' }),
    });
    const body = await r.json();
    expect(body.Value).toBe(42);
    expect(body.MessageCode).toBe(200);
  });

  it('POST /api/rest/{table} returns insert_count: 1', async () => {
    const r = await fetch(`${server.url}/api/rest/iptbedmove`, {
      method: 'POST',
      headers: { Authorization: 'Bearer X', 'Content-Type': 'application/json' },
      body: JSON.stringify({ an: 'AN1' }),
    });
    const body = await r.json();
    expect(body.insert_count).toBe(1);
  });

  it('PUT /api/rest/{table}/{id} returns update_count: 1', async () => {
    const r = await fetch(`${server.url}/api/rest/iptadm/AN1`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer X', 'Content-Type': 'application/json' },
      body: JSON.stringify({ bedno: '02' }),
    });
    const body = await r.json();
    expect(body.update_count).toBe(1);
  });

  it('DELETE /api/rest/{table}/{id} returns OK', async () => {
    const r = await fetch(`${server.url}/api/rest/iptbedmove/99`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer X' },
    });
    const body = await r.json();
    expect(body.MessageCode).toBe(200);
  });

  it('records all requests with method, path, body, auth', async () => {
    await fetch(`${server.url}/api/sql`, {
      method: 'POST',
      headers: { Authorization: 'Bearer XYZ', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });
    expect(server.recordedRequests).toHaveLength(1);
    expect(server.recordedRequests[0].method).toBe('POST');
    expect(server.recordedRequests[0].path).toBe('/api/sql');
    expect(server.recordedRequests[0].auth).toBe('Bearer XYZ');
    expect(server.recordedRequests[0].body).toMatchObject({ sql: 'SELECT 1' });
  });
});
