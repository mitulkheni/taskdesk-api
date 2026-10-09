import http from 'node:http';
import { ValidationError, validateNewTask, validateTaskPatch } from './validate.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

export function createApp(store) {
  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');

      if (pathname === '/health') {
        if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
        return send(res, 200, { status: 'ok' });
      }

      const match = pathname.match(/^\/tasks(?:\/([^/]+))?$/);
      if (!match) throw new HttpError(404, 'Not found');
      const id = match[1] ? decodeURIComponent(match[1]) : undefined;

      if (id === undefined) {
        if (req.method === 'GET') return send(res, 200, { tasks: store.list() });
        if (req.method === 'POST') {
          const task = store.create(validateNewTask(await readJson(req)));
          return send(res, 201, task);
        }
        throw new HttpError(405, 'Method not allowed');
      }

      if (req.method === 'GET') {
        const task = store.get(id);
        if (!task) throw new HttpError(404, 'Task not found');
        return send(res, 200, task);
      }
      if (req.method === 'PATCH') {
        const task = store.update(id, validateTaskPatch(await readJson(req)));
        if (!task) throw new HttpError(404, 'Task not found');
        return send(res, 200, task);
      }
      if (req.method === 'DELETE') {
        if (!store.delete(id)) throw new HttpError(404, 'Task not found');
        return send(res, 204);
      }
      throw new HttpError(405, 'Method not allowed');
    } catch (err) {
      if (err instanceof ValidationError) {
        return send(res, 400, { error: err.message, details: err.errors });
      }
      if (err instanceof HttpError) {
        return send(res, err.status, { error: err.message });
      }
      console.error(err);
      return send(res, 500, { error: 'Internal server error' });
    }
  });
}
