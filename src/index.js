import { createApp } from './server.js';
import { TaskStore } from './store.js';

const port = Number(process.env.PORT ?? 3000);
const dataFile = process.env.DATA_FILE;

let store;
try {
  store = dataFile ? await TaskStore.open(dataFile) : new TaskStore();
} catch (err) {
  console.error(`taskdesk-api: ${err.message}`);
  process.exit(1);
}

const server = createApp(store);

server.listen(port, () => {
  console.log(`taskdesk-api listening on http://localhost:${port}`);
  console.log(
    dataFile
      ? `saving tasks to ${dataFile}`
      : 'tasks are kept in memory only (set DATA_FILE to save them to disk)',
  );
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise((resolve) => server.close(resolve));
  const saved = await store.flush();
  process.exit(saved ? 0 : 1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, shutdown);
}
