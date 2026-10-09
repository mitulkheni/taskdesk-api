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

### Persistence

By default tasks live in memory and are lost when the process exits. Set `DATA_FILE` to keep them:

```sh
DATA_FILE=./data/tasks.json npm start
```

- Changes are saved in the background. Each save writes a temp file, flushes it to disk and renames
  it over the data file, so a crash mid-write can never leave a half-written file. Bursts of
  changes are coalesced into few writes.
- `SIGINT`/`SIGTERM` wait for pending saves before exiting (exit code `1` if the data could not
  be saved).
- If the data file exists but is damaged or in an unknown format, the server refuses to start
  and leaves the file untouched instead of starting empty and overwriting it.
- The file must be owned by a single server process; running several against the same file is
  not supported.

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
  server.js     HTTP routing and error mapping
  store.js      task storage (in-memory, optionally persisted to a JSON file)
  validate.js   request validation
test/           node:test suites
```
