import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { TaskStore } from '../src/store.js';

const input = { title: 'Persist me', status: 'todo', priority: 2, dueDate: null, tags: ['a'] };

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'taskdesk-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const validTask = (overrides = {}) => ({
  id: 'abc',
  title: 'Stored',
  status: 'todo',
  priority: 2,
  dueDate: null,
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const snapshot = (...tasks) => JSON.stringify({ version: 1, tasks });

test('opening a missing file creates it (and its directories) with an empty task list', async (t) => {
  const file = join(await tempDir(t), 'nested', 'deeper', 'tasks.json');
  const store = await TaskStore.open(file);
  assert.equal(store.size, 0);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, tasks: [] });
});

test('tasks survive a restart', async (t) => {
  const file = join(await tempDir(t), 'tasks.json');
  const first = await TaskStore.open(file);
  const keep = first.create(input);
  const change = first.create({ ...input, title: 'Will change' });
  const drop = first.create({ ...input, title: 'Will vanish' });
  first.update(change.id, { status: 'done', tags: ['b'] });
  first.delete(drop.id);
  assert.equal(await first.flush(), true);

  const second = await TaskStore.open(file);
  assert.deepEqual(second.list(), first.list());
  assert.equal(second.get(keep.id).title, 'Persist me');
  assert.equal(second.get(change.id).status, 'done');
  assert.equal(second.get(drop.id), undefined);
});

test('a burst of changes is coalesced and leaves no temp files behind', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'tasks.json');
  const store = await TaskStore.open(file);
  for (let i = 0; i < 200; i += 1) store.create({ ...input, title: `Task ${i}` });
  await store.flush();

  assert.deepEqual(await readdir(dir), ['tasks.json']);
  assert.equal((await TaskStore.open(file)).size, 200);
});

test('changes made while a write is in flight are not lost', async (t) => {
  const file = join(await tempDir(t), 'tasks.json');
  const store = await TaskStore.open(file);
  store.create({ ...input, title: 'first' });
  // The first write has started but not finished; this change must earn a second pass.
  await new Promise((resolve) => setImmediate(resolve));
  store.create({ ...input, title: 'second' });
  await store.flush();

  const titles = (await TaskStore.open(file)).list().map((task) => task.title);
  assert.deepEqual(titles, ['first', 'second']);
});

test('updating or deleting an unknown id does not touch the file', async (t) => {
  const file = join(await tempDir(t), 'tasks.json');
  const store = await TaskStore.open(file);
  await store.flush();
  const before = (await stat(file)).mtimeMs;

  assert.equal(store.update('missing', { status: 'done' }), undefined);
  assert.equal(store.delete('missing'), false);
  await store.flush();
  assert.equal((await stat(file)).mtimeMs, before);
});

test('refuses to open a file that is not valid JSON, and leaves it untouched', async (t) => {
  const file = join(await tempDir(t), 'tasks.json');
  await writeFile(file, '{"version":1,"tasks":[');
  await assert.rejects(TaskStore.open(file), /not valid JSON/);
  assert.equal(await readFile(file, 'utf8'), '{"version":1,"tasks":[');
});

test('refuses to open files in an unrecognised format', async (t) => {
  const dir = await tempDir(t);
  for (const [name, content] of [
    ['array.json', '[]'],
    ['version.json', JSON.stringify({ version: 2, tasks: [] })],
    ['tasks.json', JSON.stringify({ version: 1, tasks: {} })],
  ]) {
    const file = join(dir, name);
    await writeFile(file, content);
    await assert.rejects(TaskStore.open(file), /unrecognised file format/, name);
  }
});

test('refuses to open files containing invalid tasks', async (t) => {
  const dir = await tempDir(t);
  const cases = [
    [snapshot(validTask(), validTask({ id: 'def', title: '' })), /task #1 is invalid/],
    [snapshot(validTask({ id: undefined })), /task #0 has no id/],
    [snapshot(validTask(), validTask()), /task #1 repeats id abc/],
    [snapshot(validTask({ createdAt: 'yesterday' })), /invalid createdAt/],
    [snapshot(validTask({ status: 'archived' })), /task #0 is invalid/],
  ];
  for (const [index, [content, pattern]] of cases.entries()) {
    const file = join(dir, `case-${index}.json`);
    await writeFile(file, content);
    await assert.rejects(TaskStore.open(file), pattern, `case ${index}`);
  }
});

test('open fails fast when the location is unwritable', async (t) => {
  const dir = await tempDir(t);
  const blocker = join(dir, 'blocker');
  await writeFile(blocker, 'a regular file where a directory is needed');
  await assert.rejects(TaskStore.open(join(blocker, 'tasks.json')));
});

test('write failures are reported, flush() says so, and the next flush recovers', async (t) => {
  const dir = await tempDir(t);
  const dataDir = join(dir, 'data');
  const file = join(dataDir, 'tasks.json');
  const errors = [];
  const store = await TaskStore.open(file, { onPersistError: (err) => errors.push(err) });

  // Sabotage: replace the data directory with a regular file.
  await rm(dataDir, { recursive: true });
  await writeFile(dataDir, 'in the way');

  store.create(input);
  assert.equal(await store.flush(), false);
  assert.ok(errors.length >= 1);

  // Repair the location; the retry inside flush() should now succeed.
  await rm(dataDir);
  assert.equal(await store.flush(), true);
  assert.equal((await TaskStore.open(file)).size, 1);
});

test('an in-memory store never touches the filesystem and flushes instantly', async () => {
  const store = new TaskStore();
  store.create(input);
  assert.equal(await store.flush(), true);
});

test('tasks created through the HTTP API are persisted', async (t) => {
  const file = join(await tempDir(t), 'tasks.json');
  const store = await TaskStore.open(file);
  const server = createApp(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetch(`http://127.0.0.1:${server.address().port}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Over HTTP', tags: ['http'] }),
  });
  const created = await res.json();
  await store.flush();

  const reopened = await TaskStore.open(file);
  assert.deepEqual(reopened.get(created.id), created);
});
