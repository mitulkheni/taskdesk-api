import { createApp } from './server.js';
import { TaskStore } from './store.js';

const port = Number(process.env.PORT ?? 3000);
const server = createApp(new TaskStore());

server.listen(port, () => {
  console.log(`taskdesk-api listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
