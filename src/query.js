import {
  MAX_PRIORITY,
  MAX_TAG_LENGTH,
  MIN_PRIORITY,
  STATUSES,
  ValidationError,
  isCalendarDate,
} from './validate.js';

export const MAX_LIMIT = 100;
export const MAX_SEARCH_LENGTH = 100;
export const SORT_FIELDS = ['createdAt', 'dueDate', 'priority', 'title'];

const KNOWN_PARAMS = new Set([
  'status',
  'priority',
  'tag',
  'q',
  'dueFrom',
  'dueTo',
  'sort',
  'limit',
  'offset',
]);

function parseInteger(text) {
  if (!/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Turns URLSearchParams from `GET /tasks` into a validated query object.
 * Unknown or repeated parameters are rejected rather than silently ignored,
 * so a typo such as `?statuss=done` is reported instead of returning
 * unfiltered results.
 */
export function parseListQuery(searchParams) {
  // Null prototype: parameter names come from the client, and `__proto__`
  // must be recorded as an ordinary key rather than swallowed.
  const errors = Object.create(null);
  const raw = Object.create(null);

  for (const name of new Set(searchParams.keys())) {
    const values = searchParams.getAll(name);
    if (!KNOWN_PARAMS.has(name)) errors[name] = 'unknown query parameter';
    else if (values.length > 1) errors[name] = 'provide this parameter only once';
    else raw[name] = values[0];
  }

  const filters = {};

  if (raw.status !== undefined) {
    if (STATUSES.includes(raw.status)) filters.status = raw.status;
    else errors.status = `status must be one of: ${STATUSES.join(', ')}`;
  }

  if (raw.priority !== undefined) {
    const priority = parseInteger(raw.priority);
    if (priority !== undefined && priority >= MIN_PRIORITY && priority <= MAX_PRIORITY) {
      filters.priority = priority;
    } else {
      errors.priority = `priority must be an integer between ${MIN_PRIORITY} and ${MAX_PRIORITY}`;
    }
  }

  if (raw.tag !== undefined) {
    const tag = raw.tag.trim().toLowerCase();
    if (tag.length > 0 && tag.length <= MAX_TAG_LENGTH) filters.tag = tag;
    else errors.tag = `tag must be 1-${MAX_TAG_LENGTH} characters`;
  }

  if (raw.q !== undefined) {
    const text = raw.q.trim().toLowerCase();
    if (text.length > 0 && text.length <= MAX_SEARCH_LENGTH) filters.q = text;
    else errors.q = `q must be 1-${MAX_SEARCH_LENGTH} characters`;
  }

  for (const name of ['dueFrom', 'dueTo']) {
    if (raw[name] === undefined) continue;
    if (isCalendarDate(raw[name])) filters[name] = raw[name];
    else errors[name] = `${name} must be a real date in YYYY-MM-DD format`;
  }
  if (filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo) {
    errors.dueFrom = 'dueFrom must not be later than dueTo';
  }

  const sortText = raw.sort ?? 'createdAt';
  const direction = sortText.startsWith('-') ? 'desc' : 'asc';
  const field = direction === 'desc' ? sortText.slice(1) : sortText;
  if (!SORT_FIELDS.includes(field)) {
    errors.sort = `sort must be one of: ${SORT_FIELDS.join(', ')} (prefix with - for descending)`;
  }

  // Paging is opt-in: without `limit`, every matching task is returned, exactly
  // as `GET /tasks` behaved before these parameters existed.
  let limit = null;
  if (raw.limit !== undefined) {
    const parsed = parseInteger(raw.limit);
    if (parsed !== undefined && parsed >= 1 && parsed <= MAX_LIMIT) limit = parsed;
    else errors.limit = `limit must be an integer between 1 and ${MAX_LIMIT}`;
  }

  let offset = 0;
  if (raw.offset !== undefined) {
    const parsed = parseInteger(raw.offset);
    if (parsed !== undefined) offset = parsed;
    else errors.offset = 'offset must be a non-negative integer';
  }

  if (Object.keys(errors).length > 0) throw new ValidationError({ ...errors });
  return { filters, sort: { field, direction }, limit, offset };
}

function matches(task, filters) {
  if (filters.status !== undefined && task.status !== filters.status) return false;
  if (filters.priority !== undefined && task.priority !== filters.priority) return false;
  if (filters.tag !== undefined && !task.tags.includes(filters.tag)) return false;
  if (filters.q !== undefined && !task.title.toLowerCase().includes(filters.q)) return false;
  if (filters.dueFrom !== undefined || filters.dueTo !== undefined) {
    // Tasks without a due date can never fall inside a due-date range.
    if (task.dueDate === null) return false;
    if (filters.dueFrom !== undefined && task.dueDate < filters.dueFrom) return false;
    if (filters.dueTo !== undefined && task.dueDate > filters.dueTo) return false;
  }
  return true;
}

function comparator({ field, direction }) {
  const sign = direction === 'desc' ? -1 : 1;
  return (a, b) => {
    const left = a[field];
    const right = b[field];
    if (left === right) return 0;
    // Missing due dates sort last in both directions.
    if (left === null) return 1;
    if (right === null) return -1;
    if (field === 'title') {
      return sign * left.localeCompare(right, 'en', { sensitivity: 'base' });
    }
    return left < right ? -sign : sign;
  };
}

/**
 * Filters, sorts and paginates a list of tasks. A `limit` of null means "no
 * cap". Ties keep insertion order (Array.prototype.sort is stable), so pages
 * are deterministic.
 */
export function applyListQuery(tasks, { filters, sort, limit, offset }) {
  const matched = tasks.filter((task) => matches(task, filters)).sort(comparator(sort));
  return {
    items: limit === null ? matched.slice(offset) : matched.slice(offset, offset + limit),
    total: matched.length,
  };
}
