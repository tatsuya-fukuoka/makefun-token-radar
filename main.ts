// Token radar entry point (Node 22, standard library only).
//
//   node main.ts [--input <snapshot.json|dir>] [--output <dir>]
//
// Reads the frozen snapshot, builds the ranked radar with lib/model.ts, and lays the deliverables out in
// the output directory: board.json, data.js (the dashboard's dataset), dashboard/, screenshots/ and, last,
// dossier.json. The input defaults to /input and the output to $MAKEFUN_OUTPUT_DIR or /output.
//
// Exit codes: 0 done, 1 the board or the hand-in fails a check, 2 no readable snapshot.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnapshotError, boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const LIMITS = {
  textBytes: 65_536,
  shots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
  minShots: 3,
};
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const root = dirname(fileURLToPath(import.meta.url));

/** Stop the run with a one-line reason on stderr. */
function stop(code: number, reason: string): never {
  process.stderr.write(`token radar: ${reason}\n`);
  process.exit(code);
}

/** The value after `--flag value` or in `--flag=value`, else undefined. */
function option(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === `--${flag}`) return args[i + 1];
    if (a.startsWith(`--${flag}=`)) return a.slice(flag.length + 3);
  }
  return undefined;
}

/** The regular, non-hidden files of a directory, sorted by name; empty when it does not exist. */
function plainFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.') && statSync(join(dir, n)).isFile())
    .sort();
}

/** Copy the named files from one directory into another, creating it. */
function copyAll(from: string, to: string, names: string[]): void {
  mkdirSync(to, { recursive: true });
  for (const n of names) copyFileSync(join(from, n), join(to, n));
}

// --- locate the snapshot and the output directory
const inputPath = resolve(option('input') ?? '/input');
const snapshotPath = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotPath)) stop(2, `no snapshot at ${snapshotPath}: pass --input <snapshot.json|dir> or mount /input`);
const outDir = resolve(option('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// --- score
let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
} catch (e) {
  if (e instanceof SnapshotError) stop(2, e.message);
  throw e;
}
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) stop(1, `the board fails its own check: ${problem}`);

// --- check the hand-in before writing anything
const shotNames = plainFiles(join(root, 'screenshots'));
if (shotNames.length < LIMITS.minShots) stop(1, `screenshots/ has ${shotNames.length} files; hand in at least ${LIMITS.minShots} (board, detail, filtered)`);
for (const n of shotNames) {
  if (!SAFE_NAME.test(n)) stop(1, `screenshots/${n}: names use letters, digits, . _ - and run 1-128 characters`);
}

// --- write
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(outDir, 'data.js'), dataScript(radar));
const pageNames = plainFiles(join(root, 'dashboard'));
copyAll(join(root, 'dashboard'), join(outDir, 'dashboard'), pageNames);
copyAll(join(root, 'screenshots'), join(outDir, 'screenshots'), shotNames);

// The dossier goes last: it summarises everything written above.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: LIMITS.textBytes, screenshots: LIMITS.shots, dashboard: LIMITS.dashboard }),
);

console.log(
  `token radar: ${board.length} candidates ranked from ${snapshot.protocols.length} protocols ` +
    `(watchlist ${radar.watchlist_covered}/${radar.watchlist_size}, ${radar.excluded_size} excluded, ${radar.token_peers} token peers)`,
);
console.log(`token radar: wrote board.json, data.js, dashboard/ (${pageNames.length} files), screenshots/ (${shotNames.length} images) and dossier.json in ${outDir}`);
