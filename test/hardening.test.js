import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { DEFAULT_MAX_BODY_BYTES, createApp } from '../src/server.js';
import { TaskStore } from '../src/store.js';

const LIMIT = 1024;

let server;
let store;
let port;
let base;

before(async () => {
  store = new TaskStore();
  server = createApp(store, { maxBodyBytes: LIMIT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(`${base}/tasks`, { method: 'POST', headers, body });

/** Sends raw bytes so we can craft requests that fetch() refuses to produce. */
function rawRequest(payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(payload));
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => (received += chunk));
    socket.on('end', () => resolve(received));
    socket.on('error', reject);
    setTimeout(() => {
      socket.destroy();
      resolve(received);
    }, 1000).unref();
  });
}

test('createApp rejects a nonsensical body limit', () => {
  for (const maxBodyBytes of [0, -1, 1.5, '100', NaN]) {
    assert.throws(() => createApp(new TaskStore(), { maxBodyBytes }), TypeError);
  }
  assert.ok(DEFAULT_MAX_BODY_BYTES > 0);
});

test('a body at the limit is accepted', async () => {
  const prefix = JSON.stringify({ title: '' });
  const title = 'x'.repeat(LIMIT - prefix.length);
  const body = JSON.stringify({ title });
  assert.equal(Buffer.byteLength(body), LIMIT);
  // The title is too long for the schema, but the body itself must get past the size check.
  const res = await post(body);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).details.title);
});

test('a body over the limit is rejected with 413 using Content-Length', async () => {
  const res = await post(JSON.stringify({ title: 'x'.repeat(LIMIT * 4) }));
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /must not exceed 1024 bytes/);
  assert.equal(store.size, 0);
});

test('a chunked body over the limit is rejected with 413', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { port, host: '127.0.0.1', method: 'POST', path: '/tasks', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.write('{"title":"');
    req.write('y'.repeat(LIMIT * 2));
    req.end('"}');
  });
  assert.equal(status, 413);
  assert.equal(store.size, 0);
});

test('the 413 response asks the client to close the connection', async () => {
  const res = await post(JSON.stringify({ title: 'x'.repeat(LIMIT * 4) }));
  assert.equal(res.headers.get('connection'), 'close');
});

test('non-JSON content types are rejected with 415', async () => {
  for (const headers of [{ 'Content-Type': 'text/plain' }, {}]) {
    const res = await post('{"title":"hi"}', headers);
    assert.equal(res.status, 415);
  }
  assert.equal(store.size, 0);
});

test('application/json with a charset parameter is accepted', async () => {
  const res = await post('{"title":"charset"}', { 'Content-Type': 'Application/JSON; charset=utf-8' });
  assert.equal(res.status, 201);
});

test('invalid UTF-8 is rejected with 400', async () => {
  const res = await post(Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /UTF-8/);
});

test('a UTF-8 byte order mark is tolerated', async () => {
  const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"title":"bom"}')]);
  assert.equal((await post(body)).status, 201);
});

test('malformed percent-encoding in a task id is a 400, not a 500', async () => {
  const res = await fetch(`${base}/tasks/%E0%A4%A`);
  assert.equal(res.status, 400);
});

test('a request target that is not a valid URL is a 400, not a 500', async () => {
  const response = await rawRequest('GET // HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  assert.match(response, /^HTTP\/1\.1 400 /);
});

test('responses carry X-Content-Type-Options: nosniff', async () => {
  for (const path of ['/health', '/tasks', '/nope']) {
    const res = await fetch(base + path);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
  }
});
