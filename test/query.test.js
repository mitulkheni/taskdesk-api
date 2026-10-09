import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { applyListQuery, parseListQuery } from '../src/query.js';
import { createApp } from '../src/server.js';
import { TaskStore } from '../src/store.js';
import { ValidationError } from '../src/validate.js';

const parse = (qs) => parseListQuery(new URLSearchParams(qs));

const task = (overrides) => ({
  id: overrides.title,
  status: 'todo',
  priority: 2,
  dueDate: null,
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const titles = (result) => result.items.map((item) => item.title);

test('parseListQuery returns defaults for an empty query', () => {
  assert.deepEqual(parse(''), {
    filters: {},
    sort: { field: 'createdAt', direction: 'asc' },
    limit: 20,
    offset: 0,
  });
});

test('parseListQuery parses every parameter', () => {
  const query = parse(
    'status=done&priority=1&tag=%20Bug&q=Fix&dueFrom=2026-01-01&dueTo=2026-12-31&sort=-priority&limit=5&offset=10',
  );
  assert.deepEqual(query, {
    filters: {
      status: 'done',
      priority: 1,
      tag: 'bug',
      q: 'fix',
      dueFrom: '2026-01-01',
      dueTo: '2026-12-31',
    },
    sort: { field: 'priority', direction: 'desc' },
    limit: 5,
    offset: 10,
  });
});

test('parseListQuery reports every invalid parameter at once', () => {
  assert.throws(
    () => parse('status=blocked&priority=4&limit=0&offset=-1&sort=colour&dueTo=2026-02-30'),
    (err) =>
      err instanceof ValidationError &&
      ['status', 'priority', 'limit', 'offset', 'sort', 'dueTo'].every((key) => key in err.errors),
  );
});

test('parseListQuery rejects numbers that Number() would accept', () => {
  for (const value of ['', '1e2', '0x10', ' 5', '5.5', '+5']) {
    assert.throws(() => parse(new URLSearchParams({ limit: value })), ValidationError, value);
  }
});

test('parseListQuery rejects unknown and repeated parameters', () => {
  assert.throws(() => parse('statuss=done'), (err) => 'statuss' in err.errors);
  assert.throws(() => parse('status=todo&status=done'), (err) => 'status' in err.errors);
});

test('parseListQuery does not let __proto__ slip through as an unknown parameter', () => {
  assert.throws(() => parse('__proto__=x'), (err) => err.errors['__proto__'] !== undefined);
});

test('parseListQuery rejects a reversed due-date range', () => {
  assert.throws(() => parse('dueFrom=2026-06-01&dueTo=2026-01-01'), ValidationError);
});

test('applyListQuery filters by status, priority, tag and text', () => {
  const tasks = [
    task({ title: 'Fix login bug', status: 'doing', priority: 1, tags: ['bug'] }),
    task({ title: 'Write docs', status: 'todo', priority: 3, tags: ['docs'] }),
    task({ title: 'Fix typo', status: 'done', priority: 3, tags: ['docs', 'bug'] }),
  ];
  assert.deepEqual(titles(applyListQuery(tasks, parse('status=done'))), ['Fix typo']);
  assert.deepEqual(titles(applyListQuery(tasks, parse('priority=3'))), ['Write docs', 'Fix typo']);
  assert.deepEqual(titles(applyListQuery(tasks, parse('tag=BUG'))), ['Fix login bug', 'Fix typo']);
  assert.deepEqual(titles(applyListQuery(tasks, parse('q=FIX'))), ['Fix login bug', 'Fix typo']);
  assert.deepEqual(titles(applyListQuery(tasks, parse('q=fix&tag=docs'))), ['Fix typo']);
});

test('applyListQuery due-date range is inclusive and excludes undated tasks', () => {
  const tasks = [
    task({ title: 'early', dueDate: '2026-03-01' }),
    task({ title: 'edge', dueDate: '2026-04-01' }),
    task({ title: 'late', dueDate: '2026-09-01' }),
    task({ title: 'undated', dueDate: null }),
  ];
  assert.deepEqual(titles(applyListQuery(tasks, parse('dueFrom=2026-04-01'))), ['edge', 'late']);
  assert.deepEqual(titles(applyListQuery(tasks, parse('dueTo=2026-04-01'))), ['early', 'edge']);
  assert.equal(applyListQuery(tasks, parse('dueFrom=2020-01-01')).total, 3);
});

test('applyListQuery keeps undated tasks last in both sort directions', () => {
  const tasks = [
    task({ title: 'undated', dueDate: null }),
    task({ title: 'b', dueDate: '2026-02-01' }),
    task({ title: 'a', dueDate: '2026-01-01' }),
  ];
  assert.deepEqual(titles(applyListQuery(tasks, parse('sort=dueDate'))), ['a', 'b', 'undated']);
  assert.deepEqual(titles(applyListQuery(tasks, parse('sort=-dueDate'))), ['b', 'a', 'undated']);
});

test('applyListQuery sorts titles case-insensitively', () => {
  const tasks = [task({ title: 'banana' }), task({ title: 'Cherry' }), task({ title: 'apple' })];
  assert.deepEqual(titles(applyListQuery(tasks, parse('sort=title'))), ['apple', 'banana', 'Cherry']);
  assert.deepEqual(titles(applyListQuery(tasks, parse('sort=-title'))), ['Cherry', 'banana', 'apple']);
});

test('applyListQuery sorts priority with 1 (highest) first when ascending', () => {
  const tasks = [task({ title: 'low', priority: 3 }), task({ title: 'high', priority: 1 })];
  assert.deepEqual(titles(applyListQuery(tasks, parse('sort=priority'))), ['high', 'low']);
});

test('applyListQuery breaks ties by insertion order', () => {
  const tasks = ['a', 'b', 'c', 'd'].map((title) => task({ title, priority: 2 }));
  assert.deepEqual(titles(applyListQuery(tasks, parse('sort=priority'))), ['a', 'b', 'c', 'd']);
  assert.deepEqual(titles(applyListQuery(tasks, parse('sort=-priority'))), ['a', 'b', 'c', 'd']);
});

test('applyListQuery paginates and reports the unpaginated total', () => {
  const tasks = ['a', 'b', 'c', 'd', 'e'].map((title) => task({ title }));
  const page = applyListQuery(tasks, parse('limit=2&offset=2'));
  assert.deepEqual(titles(page), ['c', 'd']);
  assert.equal(page.total, 5);
  assert.deepEqual(titles(applyListQuery(tasks, parse('limit=2&offset=4'))), ['e']);
  assert.deepEqual(titles(applyListQuery(tasks, parse('offset=99'))), []);
});

let server;
let base;

before(async () => {
  const store = new TaskStore();
  for (const [title, priority] of [['one', 3], ['two', 1], ['three', 2]]) {
    store.create({ title, status: 'todo', priority, dueDate: null, tags: [] });
  }
  server = createApp(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('GET /tasks returns the page metadata alongside the tasks', async () => {
  const res = await fetch(`${base}/tasks?sort=priority&limit=2`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.tasks.map((t) => t.title), ['two', 'three']);
  assert.equal(body.total, 3);
  assert.equal(body.limit, 2);
  assert.equal(body.offset, 0);
});

test('GET /tasks answers invalid queries with a 400 and field details', async () => {
  const res = await fetch(`${base}/tasks?limit=1000&sort=nope`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.details.limit);
  assert.ok(body.details.sort);
});
