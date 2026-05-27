import { runDaemon } from "./daemon.js";

const storageRoot = process.argv[2];
runDaemon(storageRoot ? { storageRoot } : {}).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`workflow-runner daemon: ${msg}\n`);
  process.exit(1);
});
