// The `bohr` command (dist/bohr.mjs)
import { EXIT } from './errors';
import { main } from './main';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT.error;
  },
);
