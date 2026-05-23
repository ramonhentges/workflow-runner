#!/usr/bin/env node
import { main } from "./app/main.js";

if (import.meta.main) {
  main(process.argv)
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`Fatal: ${err}`);
      process.exit(1);
    });
}
