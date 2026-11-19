// Token Radar — the entry program, third revision.
//
// Node 22, standard library only, no network, deterministic.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// It reads the sealed DefiLlama snapshot, scores every rankable
// pre-token protocol with the model in lib/model.ts, and writes:
//
//   /output/board.json     — the ranked board (178 rows)
//   /output/data.js        — window.RADAR, the dashboard's dataset
//   /output/dashboard/    — the static page, copied from dashboard/
//   /output/screenshots/  — the three screenshots, copied as-is
//   /output/dossier.json  — built by vendor/makefun-board.ts
//
// In the grader the snapshot is mounted at /input/snapshot.json and
// the output directory is /output; MAKEFUN_OUTPUT_DIR stands in for
// /output when running locally. The same snapshot always writes the
// same bytes: the board is sorted with a slug tie-break, the JSON is
// written with a fixed shape, and nothing reads the clock or the
// network, so two runs byte-match.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_MAX = 65_536;

// --flag <value> and --flag=value, with a fallback when absent.
function flagValue(name: string, fallback: string): string {
  const positional = process.argv.indexOf(`--${name}`);
  if (positional >= 0 && positional + 1 < process.argv.length) return process.argv[positional + 1]!;
  const joined = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 3);
  return fallback;
}

function die(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputGiven = flagValue('input', '/input');
const inputPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(inputPath)) {
  die(`no snapshot at ${inputPath}: pass --input <snapshot.json|directory>`, 2);
}
const outputDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const refused = boardIssue(board, snapshot);
if (refused !== null) die(`board refused by the gate: ${refused}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

// Copy one directory's regular files into another, skipping
// dot-names, and return the names copied, in directory order.
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardCopied = copyDirectory(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
const shotsCopied = copyDirectory(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (shotsCopied.length < 3) {
  die(`screenshots/ holds ${shotsCopied.length} images: hand in 3, the board, a detail view and a filtered view`);
}
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const name of shotsCopied) {
  if (!IMAGE_NAME.test(name)) {
    die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier goes last: the scorer rebuilds it from this output
// directory and compares bytes, so it must see the final files.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: DOSSIER_TEXT_MAX,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const topThree = board
  .slice(0, 3)
  .map((row) => `${row.rank}. ${row.name} $${row.implied_value_usd.toLocaleString('en-US')}`)
  .join(', ');
// The dossier's byte size is part of the log, not the output: it lets
// a reader see at a glance whether the judge's source text fits whole.
const dossierBytes = statSync(join(outputDir, 'dossier.json')).size;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outputDir, 'board.json')}, ${join(outputDir, 'data.js')}, ${join(outputDir, 'dashboard')} (${dashboardCopied.length} files), ${join(outputDir, 'screenshots')} (${shotsCopied.length} images) and ${join(outputDir, 'dossier.json')}\n` +
    `token radar: top 3 are ${topThree}\n` +
    `token radar: dossier.json is ${dossierBytes.toLocaleString('en-US')} bytes\n`,
);
