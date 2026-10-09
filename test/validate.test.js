import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, validateNewTask, validateTaskPatch } from '../src/validate.js';

test('validateNewTask applies defaults', () => {
  assert.deepEqual(validateNewTask({ title: '  Write docs  ' }), {
    title: 'Write docs',
    status: 'todo',
    priority: 2,
    dueDate: null,
    tags: [],
  });
});

test('validateNewTask requires a title', () => {
  assert.throws(
    () => validateNewTask({}),
    (err) => err instanceof ValidationError && err.errors.title === 'title is required',
  );
});

test('validateNewTask rejects non-object bodies', () => {
  for (const body of [null, 'text', 42, [1, 2]]) {
    assert.throws(() => validateNewTask(body), ValidationError);
  }
});

test('validateNewTask normalises and de-duplicates tags', () => {
  const task = validateNewTask({ title: 'x', tags: [' Bug ', 'bug', 'Urgent'] });
  assert.deepEqual(task.tags, ['bug', 'urgent']);
});

test('validateNewTask rejects impossible calendar dates', () => {
  assert.throws(() => validateNewTask({ title: 'x', dueDate: '2026-02-31' }), ValidationError);
  assert.throws(() => validateNewTask({ title: 'x', dueDate: '12/10/2026' }), ValidationError);
});

test('validateNewTask collects every error, not just the first', () => {
  assert.throws(
    () => validateNewTask({ title: '', status: 'blocked', priority: 9 }),
    (err) => ['title', 'status', 'priority'].every((field) => field in err.errors),
  );
});

test('validateTaskPatch accepts a partial update', () => {
  assert.deepEqual(validateTaskPatch({ status: 'done' }), { status: 'done' });
});

test('validateTaskPatch rejects an empty patch', () => {
  assert.throws(() => validateTaskPatch({}), ValidationError);
});

test('validateTaskPatch allows clearing the due date', () => {
  assert.deepEqual(validateTaskPatch({ dueDate: null }), { dueDate: null });
});
