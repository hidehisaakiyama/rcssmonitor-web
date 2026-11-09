// Runs the replay server. It is written in TypeScript and shares the log
// parsers with the app, so it is loaded through Vite's module runner.
//
//   npm run replay-server -- [options] LOG
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const { module } = await runnerImport(
  fileURLToPath(new URL('./replay-server.ts', import.meta.url)),
);
const server = await module.main(process.argv.slice(2));
if (server) {
  const stop = () => void server.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
