import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ValidationError, validateNewTask } from './validate.js';

const FILE_VERSION = 1;

function serialise(tasks) {
  return `${JSON.stringify({ version: FILE_VERSION, tasks }, null, 2)}\n`;
}

/**
 * Replaces `filePath` with `contents` without ever exposing a half-written
 * file: write to a temp file in the same directory, flush it to disk, then
 * rename over the target (atomic on POSIX filesystems).
 */
async function writeFileAtomic(filePath, contents) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
  } catch (err) {
    await rm(tempPath, { force: true });
    throw err;
  }
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

/** Parses and validates a snapshot file. Throws a descriptive Error if anything is off. */
function parseSnapshot(text, filePath) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Cannot load ${filePath}: not valid JSON (${err.message})`);
  }
  if (data?.version !== FILE_VERSION || !Array.isArray(data.tasks)) {
    throw new Error(`Cannot load ${filePath}: unrecognised file format`);
  }

  const seen = new Set();
  return data.tasks.map((entry, index) => {
    const where = `Cannot load ${filePath}: task #${index}`;
    if (typeof entry?.id !== 'string' || entry.id.length === 0) {
      throw new Error(`${where} has no id`);
    }
    if (seen.has(entry.id)) throw new Error(`${where} repeats id ${entry.id}`);
    seen.add(entry.id);
    for (const key of ['createdAt', 'updatedAt']) {
      if (!isIsoTimestamp(entry[key])) throw new Error(`${where} has an invalid ${key}`);
    }

    let fields;
    try {
      fields = validateNewTask({
        title: entry.title,
        status: entry.status,
        priority: entry.priority,
        dueDate: entry.dueDate,
        tags: entry.tags,
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new Error(`${where} is invalid: ${JSON.stringify(err.errors)}`);
      }
      throw err;
    }
    return { id: entry.id, ...fields, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
  });
}

/**
 * Task storage. Every method returns copies so callers can never mutate
 * stored state by accident.
 *
 * By default tasks live in memory only. `TaskStore.open(filePath)` returns a
 * store that also persists every change to a JSON file. Persistence is
 * asynchronous: mutations return immediately and are written in the background
 * (bursts are coalesced into as few writes as possible). Call `flush()` before
 * exiting to wait for outstanding writes.
 *
 * The file is meant to be owned by a single process; concurrent writers are
 * not supported.
 */
export class TaskStore {
  #tasks = new Map();
  #filePath;
  #onPersistError;
  #dirty = false; // a change has not yet been handed to the writer
  #unsaved = false; // the most recent write attempt failed
  #writing = null; // promise for the running write loop, if any

  /**
   * @param {{ onPersistError?: (err: Error) => void }} [options] Called when a
   *   background write fails. Defaults to logging on stderr.
   */
  constructor({ onPersistError = defaultPersistErrorHandler } = {}) {
    this.#onPersistError = onPersistError;
  }

  /**
   * Opens (or creates) a persistent store backed by `filePath`. Refuses to
   * start if the file exists but cannot be parsed, so a damaged file is never
   * silently replaced by an empty one.
   */
  static async open(filePath, options) {
    const store = new TaskStore(options);
    let text;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // First run: create the file now so an unwritable location fails at
      // startup rather than on the first request.
      await writeFileAtomic(filePath, serialise([]));
    }
    if (text !== undefined) {
      for (const task of parseSnapshot(text, filePath)) store.#tasks.set(task.id, task);
    }
    store.#filePath = filePath;
    return store;
  }

  create(input) {
    const now = new Date().toISOString();
    const task = {
      id: randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.#tasks.set(task.id, task);
    this.#persist();
    return structuredClone(task);
  }

  get(id) {
    const task = this.#tasks.get(id);
    return task ? structuredClone(task) : undefined;
  }

  list() {
    return [...this.#tasks.values()].map((task) => structuredClone(task));
  }

  update(id, patch) {
    const existing = this.#tasks.get(id);
    if (!existing) return undefined;
    const updated = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.#tasks.set(id, updated);
    this.#persist();
    return structuredClone(updated);
  }

  delete(id) {
    const removed = this.#tasks.delete(id);
    if (removed) this.#persist();
    return removed;
  }

  get size() {
    return this.#tasks.size;
  }

  /**
   * Resolves once all changes made so far are on disk, retrying once if the
   * last write failed. Resolves to `false` if the data still could not be
   * saved (the failure has already been reported through `onPersistError`).
   * Always `true` for an in-memory store.
   */
  async flush() {
    while (this.#writing) await this.#writing;
    if (this.#unsaved) {
      this.#dirty = true;
      this.#writing ??= this.#drain();
      await this.#writing;
    }
    return !this.#unsaved;
  }

  #persist() {
    if (this.#filePath === undefined) return;
    this.#dirty = true;
    this.#writing ??= this.#drain();
  }

  async #drain() {
    try {
      while (this.#dirty) {
        // Clear the flag before snapshotting: a change made while the write is
        // in flight sets it again and earns another pass of this loop.
        this.#dirty = false;
        const snapshot = serialise([...this.#tasks.values()]);
        try {
          await writeFileAtomic(this.#filePath, snapshot);
          this.#unsaved = false;
        } catch (err) {
          this.#unsaved = true;
          this.#onPersistError(err);
        }
      }
    } finally {
      this.#writing = null;
    }
  }
}

function defaultPersistErrorHandler(err) {
  console.error('taskdesk-api: failed to save tasks:', err);
}
