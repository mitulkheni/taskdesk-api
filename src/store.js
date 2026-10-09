import { randomUUID } from 'node:crypto';

/**
 * In-memory task storage. Every method returns copies so callers can never
 * mutate stored state by accident.
 */
export class TaskStore {
  #tasks = new Map();

  create(input) {
    const now = new Date().toISOString();
    const task = {
      id: randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.#tasks.set(task.id, task);
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
    return structuredClone(updated);
  }

  delete(id) {
    return this.#tasks.delete(id);
  }

  get size() {
    return this.#tasks.size;
  }
}
