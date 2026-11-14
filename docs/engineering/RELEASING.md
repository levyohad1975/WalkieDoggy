# Releasing the web app (walkielink.co.il)

## The rule

Production is built from **one branch only: `feat/walk-lifecycle-gps-v1-1`**,
and only from a commit that **contains what production runs now**.

## Why

On 2026-11-06, 21 fixes were deployed to production from
`fix/gps-resume-live-pee`. On 2026-11-09 a production deploy from
`feat/walk-lifecycle-gps-v1-1`, which did not contain them, silently rolled
all 21 back: live pee/poop sharing, member photo saving and the GPS wake lock,
among others. The owner found them broken one by one over the next day.

## How it is enforced

`vercel.json` builds with:

```
node scripts/release-guard.js && npx expo export --platform web && node scripts/write-version.js
```

- `scripts/write-version.js` publishes `/version.json` (`sha`, `ref`, `env`,
  `builtAt`) with every build, so anyone can see what is live:
  `https://walkielink.co.il/version.json`.
- `scripts/release-guard.js`, for **production builds only**:
  1. fails if the build is not from the release branch;
  2. reads the live `/version.json` and asks GitHub whether the new commit
     contains it. `ahead` / `identical` pass. `behind` / `diverged` fail,
     listing the commits that would be lost.
  If the live version or GitHub cannot be reached, it warns and continues;
  a definite "behind/diverged" always fails. Preview builds are never
  checked.

## Releasing

1. Commit to `feat/walk-lifecycle-gps-v1-1` and push.
2. Wait for CI, Batch 2 Supabase Rehearsal and Integration Full-Chain
   Supabase Rehearsal to pass.
3. Deploy that commit to production (Vercel, target `production`).
4. Check `https://walkielink.co.il/version.json` shows the new commit.

Work done on another branch is merged into the release branch first
(never force-push).

## Rolling back

Use Vercel's instant rollback / promote of an earlier deployment. It does
not rebuild, so the guard is not involved. To build something deliberately
older, set `RELEASE_GUARD_OVERRIDE=1` for that one deployment, and say why
in the deployment message.
