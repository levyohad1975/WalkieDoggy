#!/usr/bin/env node
/**
 * Stamps the built site with what it was built from: dist/version.json
 * ({ sha, ref, env, builtAt }). Runs last in the Vercel build. The next
 * production build's release guard (scripts/release-guard.js) reads the
 * live copy at https://walkielink.co.il/version.json to make sure it does
 * not roll production back. Contains no secrets.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'dist', 'version.json');
const version = {
  sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
  ref: process.env.VERCEL_GIT_COMMIT_REF || null,
  env: process.env.VERCEL_ENV || 'local',
  builtAt: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(version, null, 2)}\n`);
console.log(`write-version: ${out} → ${version.sha ? version.sha.slice(0, 7) : 'no sha'} (${version.ref || 'no ref'})`);
