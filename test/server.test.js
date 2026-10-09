import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { TaskStore } from '../src/store.js';

let server;
let base;

before(async () => {
  server = createApp(new TaskStore());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const json = (method, path, body) =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('GET /health', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('task lifecycle: create, read, update, delete', async () => {
  const created = await json('POST', '/tasks', { title: 'Lifecycle', tags: ['e2e'] });
  assert.equal(created.status, 201);
  const task = await created.json();

  const fetched = await (await fetch(`${base}/tasks/${task.id}`)).json();
  assert.equal(fetched.title, 'Lifecycle');

  const patched = await json('PATCH', `/tasks/${task.id}`, { status: 'done' });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).status, 'done');

  assert.equal((await json('DELETE', `/tasks/${task.id}`)).status, 204);
  assert.equal((await fetch(`${base}/tasks/${task.id}`)).status, 404);
});

test('POST /tasks returns field-level validation errors', async () => {
  const res = await json('POST', '/tasks', { title: '', priority: 7 });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.details.title);
  assert.ok(body.details.priority);
});

test('malformed JSON is a 400, not a 500', async () => {
  const res = await fetch(`${base}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{nope',
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not valid JSON/);
});

test('unknown routes and methods', async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await json('PUT', '/tasks')).status, 405);
});
