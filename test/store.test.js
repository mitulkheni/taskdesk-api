import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from '../src/store.js';

const input = { title: 'Ship it', status: 'todo', priority: 2, dueDate: null, tags: ['a'] };

test('create assigns an id and timestamps', () => {
  const task = new TaskStore().create(input);
  assert.match(task.id, /^[0-9a-f-]{36}$/);
  assert.equal(task.createdAt, task.updatedAt);
});

test('get returns a copy that cannot mutate stored state', () => {
  const store = new TaskStore();
  const { id } = store.create(input);
  const copy = store.get(id);
  copy.title = 'changed';
  copy.tags.push('b');
  assert.equal(store.get(id).title, 'Ship it');
  assert.deepEqual(store.get(id).tags, ['a']);
});

test('update merges fields but never changes id or createdAt', () => {
  const store = new TaskStore();
  const created = store.create(input);
  const updated = store.update(created.id, { status: 'done', id: 'evil', createdAt: 'never' });
  assert.equal(updated.status, 'done');
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
});

test('update and delete report missing tasks', () => {
  const store = new TaskStore();
  assert.equal(store.update('nope', { status: 'done' }), undefined);
  assert.equal(store.delete('nope'), false);
});

test('delete removes the task', () => {
  const store = new TaskStore();
  const { id } = store.create(input);
  assert.equal(store.delete(id), true);
  assert.equal(store.get(id), undefined);
  assert.equal(store.size, 0);
});
