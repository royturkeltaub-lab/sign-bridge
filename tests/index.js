// Entry point for `node --test tests/` (the `npm test` script).
// Node 22 does not expand a directory argument into test files: it resolves `tests/` as a
// module, i.e. this file. Load every *.test.js next to it so the script keeps working.
// (`node --test` and `node --test "tests/*.test.js"` run the files individually and skip this one.)
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = (await readdir(dir)).filter((name) => name.endsWith('.test.js')).sort();
for (const name of files) await import(pathToFileURL(path.join(dir, name)).href);
