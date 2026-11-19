#!/usr/bin/env node
/**
 * Release guard — runs first in the Vercel build (vercel.json buildCommand).
 *
 * Why (incident 2026-11-09/10): two branches both deployed to production.
 * fix/gps-resume-live-pee shipped 21 fixes on 2026-11-06; a later production
 * deploy from feat/walk-lifecycle-gps-v1-1, which did not contain them,
 * silently rolled all 21 back (live pee/poop, member photos, the GPS wake
 * lock, ...). Nothing stopped a build that was BEHIND what was live.
 *
 * For a PRODUCTION build only, this script refuses to continue unless:
 *   1. it builds the release branch (RELEASE_BRANCH), and
 *   2. the commit being built contains the commit that is live right now
 *      (read from https://walkielink.co.il/version.json, which every build
 *      publishes via scripts/write-version.js), checked with GitHub's
 *      compare API: "ahead" or "identical" pass; "behind" or "diverged"
 *      fail and list what is missing.
 * Preview builds are never blocked. If the live version or GitHub cannot be
 * reached, the guard warns and lets the build continue (it must not take the
 * site hostage to a network blip); a definite "behind/diverged" always fails.
 *
 * To deploy something that is deliberately not a descendant of production
 * (a real rollback), use Vercel's instant rollback / promote of an earlier
 * deployment — that does not rebuild, so it does not pass through here — or
 * set RELEASE_GUARD_OVERRIDE=1 on that one deployment.
 */
'use strict';

const RELEASE_BRANCH = 'feat/walk-lifecycle-gps-v1-1';
const REPO = 'levyohad1975/WalkieDoggy';
const PRODUCTION_VERSION_URL = 'https://walkielink.co.il/version.json';
const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Pure decision, so it can be tested without a network.
 * @param {{ vercelEnv?: string, ref?: string, sha?: string, override?: boolean,
 *           liveSha?: string | null, compare?: { status: string, behind_by?: number, commits?: string[] } | null }} input
 * @returns {{ ok: boolean, message: string }}
 */
function decideRelease(input) {
  const { vercelEnv, ref, sha, override, liveSha, compare } = input;
  if (vercelEnv !== 'production') return { ok: true, message: `release-guard: ${vercelEnv || 'local'} build, not checked` };
  if (override) return { ok: true, message: 'release-guard: RELEASE_GUARD_OVERRIDE=1 — checks skipped for this deployment' };
  if (ref !== RELEASE_BRANCH) {
    return {
      ok: false,
      message: `release-guard: production builds come only from ${RELEASE_BRANCH}; this build is from "${ref || 'unknown'}". Merge the change into ${RELEASE_BRANCH} and deploy that.`,
    };
  }
  if (!liveSha) return { ok: true, message: 'release-guard: live version unknown (first stamped deploy or unreachable) — ancestry not checked' };
  if (!sha || liveSha === sha) return { ok: true, message: 'release-guard: same commit as production' };
  if (!compare) return { ok: true, message: `release-guard: GitHub compare unavailable — could not verify that ${sha.slice(0, 7)} contains live ${liveSha.slice(0, 7)}` };
  if (compare.status === 'ahead' || compare.status === 'identical') {
    return { ok: true, message: `release-guard: ${sha.slice(0, 7)} contains live ${liveSha.slice(0, 7)} — OK` };
  }
  const missing = (compare.commits || []).slice(0, 20).map((line) => `  - ${line}`).join('\n');
  return {
    ok: false,
    message:
      `release-guard: BLOCKED. Production runs ${liveSha.slice(0, 7)}, which this build (${sha.slice(0, 7)}) does not contain ` +
      `(${compare.status}, ${compare.behind_by ?? '?'} commit(s) missing). Deploying it would roll those fixes back.\n` +
      (missing ? `Missing from this build:\n${missing}\n` : '') +
      `Merge production's commits into ${RELEASE_BRANCH} first.`,
  };
}

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const vercelEnv = process.env.VERCEL_ENV;
  const ref = process.env.VERCEL_GIT_COMMIT_REF;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const override = process.env.RELEASE_GUARD_OVERRIDE === '1';

  let liveSha = null;
  let compare = null;
  if (vercelEnv === 'production' && !override && ref === RELEASE_BRANCH) {
    const live = await fetchJson(`${PRODUCTION_VERSION_URL}?t=${Date.now()}`);
    liveSha = live && typeof live.sha === 'string' && SHA_PATTERN.test(live.sha) ? live.sha : null;
    if (liveSha && sha && liveSha !== sha) {
      const raw = await fetchJson(`https://api.github.com/repos/${REPO}/compare/${liveSha}...${sha}`, {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'walkie-doggy-release-guard',
      });
      if (raw && typeof raw.status === 'string') {
        // For "behind"/"diverged", list the commits production has and this build lacks.
        let commits = [];
        if (raw.status === 'behind' || raw.status === 'diverged') {
          const back = await fetchJson(`https://api.github.com/repos/${REPO}/compare/${sha}...${liveSha}`, {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'walkie-doggy-release-guard',
          });
          commits = ((back && back.commits) || []).map((c) => `${c.sha.slice(0, 7)} ${String(c.commit?.message || '').split('\n')[0]}`);
        }
        compare = { status: raw.status, behind_by: raw.behind_by, commits };
      }
    }
  }

  const decision = decideRelease({ vercelEnv, ref, sha, override, liveSha, compare });
  (decision.ok ? console.log : console.error)(decision.message);
  if (!decision.ok) process.exit(1);
}

module.exports = { decideRelease, RELEASE_BRANCH };

if (require.main === module) {
  main().catch((error) => {
    // An unexpected bug in the guard itself must not block a release.
    console.warn('release-guard: internal error, continuing —', error && error.message);
  });
}
