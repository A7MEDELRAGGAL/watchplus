/* eslint-disable no-console */
/**
 * Strict UTF-8 validation over the source tree.
 *
 *   npm run check:encoding
 *
 * A file that is not valid UTF-8, or that contains U+FFFD, will render as
 * mojibake in the editor and — worse — ship to production. This project is
 * Arabic-first, so mixed RTL/LTR and Arabic in comments and string literals are
 * normal, and the failure mode is silent: a mangled string only shows up as odd
 * characters on the page.
 *
 * Strict decoder, not the forgiving one: Encoding.UTF8 with throwOnInvalidBytes
 * reports a byte sequence that merely *looks* wrong, which a replacement-char
 * decode would silently swallow.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.md', '.yml', '.yaml']);
const SKIP = new Set(['node_modules', '.next', '.git', 'out', 'dist', 'build', 'storage', '.vercel']);

const strict = new TextDecoder('utf-8', { fatal: true });

let checked = 0;
let bad = 0;

function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (EXTS.has(extname(entry))) {
      check(full);
    }
  }
}

function check(file: string) {
  const rel = relative(ROOT, file);
  const buf = readFileSync(file);
  checked += 1;

  let text: string;
  try {
    text = strict.decode(buf);
  } catch {
    bad += 1;
    console.error(`  INVALID UTF-8   ${rel}`);
    return;
  }

  // Valid UTF-8 can still contain U+FFFD if it was written after a lossy decode
  // (read as cp1252, written back as UTF-8) — that mangles Arabic silently.
  const idx = text.indexOf('\ufffd');
  if (idx !== -1) {
    bad += 1;
    const line = text.slice(0, idx).split('\n').length;
    const ctx = text.split('\n')[line - 1]?.trim().slice(0, 70) ?? '';
    console.error(`  U+FFFD at line ${line}  ${rel}`);
    console.error(`      ${ctx}`);
  }
}

walk(ROOT);

console.log(`\n  ${checked} file(s) checked, ${bad} problem(s)`);
if (bad) {
  console.log('  Re-save the listed files as UTF-8 (no BOM). Do not just replace the');
  console.log('  glyphs — the surrounding text has usually been re-encoded too.\n');
  process.exitCode = 1;
} else {
  console.log('  all valid UTF-8\n');
}
