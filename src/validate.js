export const STATUSES = ['todo', 'doing', 'done'];
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 3;
export const MAX_TITLE_LENGTH = 200;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ValidationError extends Error {
  constructor(errors) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkTitle(value, errors) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.title = 'title must be a non-empty string';
    return undefined;
  }
  const title = value.trim();
  if (title.length > MAX_TITLE_LENGTH) {
    errors.title = `title must be at most ${MAX_TITLE_LENGTH} characters`;
    return undefined;
  }
  return title;
}

function checkStatus(value, errors) {
  if (!STATUSES.includes(value)) {
    errors.status = `status must be one of: ${STATUSES.join(', ')}`;
    return undefined;
  }
  return value;
}

function checkPriority(value, errors) {
  if (!Number.isInteger(value) || value < MIN_PRIORITY || value > MAX_PRIORITY) {
    errors.priority = `priority must be an integer between ${MIN_PRIORITY} and ${MAX_PRIORITY}`;
    return undefined;
  }
  return value;
}

/** True for a `YYYY-MM-DD` string that names a real calendar date. */
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function checkDueDate(value, errors) {
  if (value === null) return null;
  if (!isCalendarDate(value)) {
    errors.dueDate = 'dueDate must be null or a real date in YYYY-MM-DD format';
    return undefined;
  }
  return value;
}

function checkTags(value, errors) {
  if (!Array.isArray(value) || value.length > MAX_TAGS) {
    errors.tags = `tags must be an array of at most ${MAX_TAGS} strings`;
    return undefined;
  }
  const cleaned = [];
  for (const tag of value) {
    if (typeof tag !== 'string' || tag.trim().length === 0 || tag.trim().length > MAX_TAG_LENGTH) {
      errors.tags = `each tag must be a non-empty string of at most ${MAX_TAG_LENGTH} characters`;
      return undefined;
    }
    const normalised = tag.trim().toLowerCase();
    if (!cleaned.includes(normalised)) cleaned.push(normalised);
  }
  return cleaned;
}

const CHECKERS = {
  title: checkTitle,
  status: checkStatus,
  priority: checkPriority,
  dueDate: checkDueDate,
  tags: checkTags,
};

export function validateNewTask(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError({ body: 'request body must be a JSON object' });
  }
  const errors = {};
  const task = {
    status: 'todo',
    priority: 2,
    dueDate: null,
    tags: [],
  };

  if (!('title' in body)) {
    errors.title = 'title is required';
  }
  for (const [field, check] of Object.entries(CHECKERS)) {
    if (!(field in body)) continue;
    const value = check(body[field], errors);
    if (value !== undefined) task[field] = value;
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return task;
}

export function validateTaskPatch(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError({ body: 'request body must be a JSON object' });
  }
  const errors = {};
  const patch = {};

  for (const [field, check] of Object.entries(CHECKERS)) {
    if (!(field in body)) continue;
    const value = check(body[field], errors);
    if (value !== undefined) patch[field] = value;
  }

  if (Object.keys(errors).length === 0 && Object.keys(patch).length === 0) {
    errors.body = `provide at least one of: ${Object.keys(CHECKERS).join(', ')}`;
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return patch;
}
