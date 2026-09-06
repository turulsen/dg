#!/usr/bin/env node
/*
 * Enforces the standing CLAUDE.md rule: "Bump sw.js's CACHE_NAME in the
 * same commit as any change to a SHELL_FILES-listed file, or returning
 * visitors can stay stuck on old JS indefinitely." That exact failure
 * mode already happened for real once (see sw.js's own header comment
 * about the Aug 27 stats/dice-roller.js move breaking every install for
 * over a week) -- this script is that lesson turned into a CI gate
 * instead of something only living in a comment someone has to remember
 * to reread.
 *
 * Usage: node scripts/check-shell-cache-bump.js <base-ref> <head-ref>
 * Exits non-zero (and prints which files triggered it) if any
 * SHELL_FILES-listed file changed between the two refs without sw.js's
 * CACHE_NAME line also changing.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [, , baseRef, headRef] = process.argv;
if (!baseRef || !headRef) {
  console.error('Usage: check-shell-cache-bump.js <base-ref> <head-ref>');
  process.exit(2);
}

// A brand-new branch's "before" SHA from a push event is all-zeros --
// nothing to diff against, so there's nothing this check can say.
if (/^0+$/.test(baseRef)) {
  console.log('First push on this ref -- nothing to diff against, skipping.');
  process.exit(0);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

// Parse SHELL_FILES out of the HEAD version of sw.js -- not require()'d
// (it's a service worker, not a module) and not regex'd against the
// working tree, since what matters is what's actually in the commit
// range being checked, not whatever's currently checked out locally.
function readShellFilesAt(ref) {
  const src = git(['show', `${ref}:sw.js`]);
  const match = src.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
  if (!match) {
    throw new Error(`Could not find SHELL_FILES array in sw.js at ${ref}`);
  }
  return Array.from(match[1].matchAll(/'([^']+)'/g))
    .map((m) => m[1])
    .filter((f) => f !== './');
}

const shellFiles = readShellFilesAt(headRef);
const changedFiles = git(['diff', '--name-only', baseRef, headRef])
  .split('\n')
  .filter(Boolean);

const violations = shellFiles.filter((f) => changedFiles.includes(f));

let cacheBumped = false;
if (changedFiles.includes('sw.js')) {
  const swDiff = git(['diff', baseRef, headRef, '--', 'sw.js']);
  cacheBumped = /^[+-].*CACHE_NAME\s*=/m.test(swDiff);
}

if (violations.length > 0 && !cacheBumped) {
  console.error('CACHE_NAME was not bumped, but these SHELL_FILES-listed files changed:');
  violations.forEach((f) => console.error('  - ' + f));
  console.error('');
  console.error('Bump sw.js\'s CACHE_NAME in the same commit/push, or returning');
  console.error('visitors can stay stuck on old JS indefinitely. See CLAUDE.md.');
  process.exit(1);
}

console.log('Shell-cache discipline OK' + (violations.length ? ' (CACHE_NAME bumped).' : ' (no SHELL_FILES changes).'));
