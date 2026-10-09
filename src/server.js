import http from 'node:http';
import { ValidationError, validateNewTask, validateTaskPatch } from './validate.js';

export const DEFAULT_MAX_BODY_BYTES = 100 * 1024;

const utf8 = new TextDecoder('utf-8', { fatal: true });

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {{ closeConnection?: boolean }} [options] Set when the request body
   *   was not (fully) read, so the connection cannot be reused for keep-alive.
   */
  constructor(status, message, { closeConnection = false } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.closeConnection = closeConnection;
  }
}

function send(res, status, body, headers = {}) {
  const baseHeaders = { 'X-Content-Type-Options': 'nosniff', ...headers };
  if (body === undefined) {
    res.writeHead(status, baseHeaders);
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...baseHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function bodyTooLarge(limit) {
  return new HttpError(413, `Request body must not exceed ${limit} bytes`, {
    closeConnection: true,
  });
}

/** Buffers the request body, giving up as soon as it grows past `limit` bytes. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) {
      reject(bodyTooLarge(limit));
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return; // keep draining, but never buffer past the limit
      size += chunk.length;
      if (size > limit) {
        settled = true;
        chunks.length = 0;
        reject(bodyTooLarge(limit));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function hasBody(req) {
  return (
    req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length']) > 0
  );
}

async function readJson(req, limit) {
  if (!hasBody(req)) return {};

  const mediaType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json', { closeConnection: true });
  }

  const buffer = await readBody(req, limit);
  let text;
  try {
    text = utf8.decode(buffer);
  } catch {
    throw new HttpError(400, 'Request body must be valid UTF-8');
  }
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

function decodeId(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, 'Task id contains malformed percent-encoding');
  }
}

export function createApp(store, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new TypeError('maxBodyBytes must be a positive integer');
  }

  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');

      if (pathname === '/health') {
        if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
        return send(res, 200, { status: 'ok' });
      }

      const match = pathname.match(/^\/tasks(?:\/([^/]+))?$/);
      if (!match) throw new HttpError(404, 'Not found');
      const id = match[1] ? decodeId(match[1]) : undefined;

      if (id === undefined) {
        if (req.method === 'GET') return send(res, 200, { tasks: store.list() });
        if (req.method === 'POST') {
          const task = store.create(validateNewTask(await readJson(req, maxBodyBytes)));
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
        const task = store.update(id, validateTaskPatch(await readJson(req, maxBodyBytes)));
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
        if (!err.closeConnection) return send(res, err.status, { error: err.message });
        // The body was left unread; close once the response is flushed so the
        // leftover bytes cannot be misread as the start of the next request.
        res.once('finish', () => req.destroy());
        return send(res, err.status, { error: err.message }, { Connection: 'close' });
      }
      if (err?.code === 'ERR_INVALID_URL') {
        return send(res, 400, { error: 'Malformed request URL' });
      }
      console.error(err);
      return send(res, 500, { error: 'Internal server error' });
    }
  });
}
