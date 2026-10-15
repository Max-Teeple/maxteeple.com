import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'glance', 'build-id.ts');

function commit() {
  const fromCi = process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || '';
  if (fromCi.trim()) return fromCi.trim();
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const sha = commit();
const id = sha ? sha.slice(0, 12) : new Date().toISOString();
const next = `/** Replaced at deploy time by scripts/stamp-glance.mjs. */\nexport const GLANCE_BUILD = ${JSON.stringify(id)};\n`;
const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
if (current !== next) fs.writeFileSync(file, next);
console.log(`glance build ${id}`);
