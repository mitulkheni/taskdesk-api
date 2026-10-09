# taskdesk-api

A small, dependency-free REST API for managing tasks, built on Node's built-in `http` module.
It exists as a compact codebase for exercising pull-request workflows and automated code review.

## Requirements

- Node.js 20 or newer (no `npm install` needed — there are no dependencies)

## Run

```sh
npm start            # listens on http://localhost:3000
PORT=8080 npm start  # custom port
npm test             # runs the test suite with node:test
```

## API

| Method | Path          | Description                  |
| ------ | ------------- | ---------------------------- |
| GET    | `/health`     | Liveness check               |
| GET    | `/tasks`      | List tasks                   |
| POST   | `/tasks`      | Create a task                |
| GET    | `/tasks/:id`  | Fetch one task               |
| PATCH  | `/tasks/:id`  | Update any subset of fields  |
| DELETE | `/tasks/:id`  | Delete a task                |

### Task fields

| Field      | Type                              | Default  | Notes                                |
| ---------- | --------------------------------- | -------- | ------------------------------------ |
| `title`    | string                            | required | 1–200 characters, trimmed            |
| `status`   | `todo` \| `doing` \| `done`       | `todo`   |                                      |
| `priority` | integer 1–3                       | `2`      | 1 is highest                         |
| `dueDate`  | `YYYY-MM-DD` string or `null`     | `null`   | must be a real calendar date         |
| `tags`     | array of up to 10 strings         | `[]`     | lower-cased and de-duplicated        |

### Listing tasks

`GET /tasks` accepts these optional query parameters. Unknown or repeated parameters are rejected
with `400` rather than ignored, so typos surface immediately.

| Parameter  | Example                | Meaning                                                              |
| ---------- | ---------------------- | -------------------------------------------------------------------- |
| `status`   | `status=doing`         | Exact status match                                                   |
| `priority` | `priority=1`           | Exact priority match                                                 |
| `tag`      | `tag=bug`              | Tasks carrying the tag (case-insensitive)                            |
| `q`        | `q=login`              | Case-insensitive substring match on the title                        |
| `dueFrom`  | `dueFrom=2026-10-01`   | Due on or after this date (tasks without a due date are excluded)    |
| `dueTo`    | `dueTo=2026-10-31`     | Due on or before this date (tasks without a due date are excluded)   |
| `sort`     | `sort=-dueDate`        | One of `createdAt` (default), `dueDate`, `priority`, `title`; prefix `-` for descending. Tasks without a due date always sort last. Ascending `priority` lists priority 1 first. |
| `limit`    | `limit=50`             | Page size, 1–100 (default 20)                                        |
| `offset`   | `offset=20`            | Number of matching tasks to skip (default 0)                         |

The response is `{ "tasks": [...], "total": <matches before paging>, "limit": n, "offset": n }`.

### Example

```sh
curl -X POST localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Write release notes","priority":1,"tags":["docs"]}'
```

Validation failures return `400` with a `details` object keyed by field name.

## Layout

```
src/
  index.js      process entry point
  query.js      list filtering, sorting and pagination
  server.js     HTTP routing and error mapping
  store.js      in-memory task storage
  validate.js   request validation
test/           node:test suites
```
