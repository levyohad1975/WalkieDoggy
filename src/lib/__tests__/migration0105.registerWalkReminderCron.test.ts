import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox — same convention as migration0101/0102). See
 * migration 0105's own header comment for the full root cause: no cron job
 * ever invoked send-walk-reminders on a schedule, and the project's own
 * `supabase_vault` extension (needed to read the cron secret from SQL) was
 * found not installed on 2026-10-08.
 */
describe('migration 0105 — registers the walk-reminder cron job with a Vault hard guard', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(path.join(migrationsDir, '0105_register_walk_reminder_cron.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file — only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of ['0025_walk_reminder_scheduler.sql', '0091_enable_gps_retention_cron.sql', '0104_preserve_schedule_entries_on_activity_reset.sql']) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0105_'))).toHaveLength(1);
  });

  it('enables pg_cron, pg_net and supabase_vault idempotently', () => {
    expect(source).toMatch(/create extension if not exists pg_cron with schema extensions;/);
    expect(source).toMatch(/create extension if not exists pg_net with schema extensions;/);
    expect(source).toMatch(/create extension if not exists supabase_vault;/);
  });

  it('hard-guards on the Vault secret existing before ever touching cron.schedule — never registers a job with a missing secret', () => {
    const declIdx = source.indexOf('declare');
    expect(declIdx).toBeGreaterThan(-1);
    const guardIdx = source.indexOf('if not secret_exists then');
    const scheduleIdx = source.indexOf('cron.schedule(');
    expect(guardIdx).toBeGreaterThan(declIdx);
    expect(scheduleIdx).toBeGreaterThan(guardIdx);
    const guardBlock = source.slice(guardIdx, scheduleIdx);
    expect(guardBlock).toMatch(/raise exception/);
    expect(guardBlock).toContain('walk_reminder_cron_secret');
  });

  it('checks for the secret via vault.decrypted_secrets, scoped to the exact secret name', () => {
    expect(source).toMatch(/select exists \(\s*\n\s*select 1 from vault\.decrypted_secrets where name = 'walk_reminder_cron_secret'\s*\n\s*\) into secret_exists;/);
  });

  it('never embeds the actual secret value — only ever references it by name', () => {
    // The only secret-like string literal anywhere in the file is the
    // secret's NAME, never a pasted credential.
    const quoted = source.match(/'[^']*'/g) ?? [];
    const secretNameOccurrences = quoted.filter((q) => q === "'walk_reminder_cron_secret'").length;
    expect(secretNameOccurrences).toBeGreaterThan(0);
    expect(source).not.toMatch(/vault\.create_secret\(\s*'[^']{20,}'/);
  });

  it('registers the job only if not already present, posting to send-walk-reminders with the x-cron-secret header sourced live from Vault', () => {
    expect(source).toMatch(/if not exists \(select 1 from cron\.job where jobname = 'walkie-send-walk-reminders'\) then/);
    expect(source).toMatch(/url := 'https:\/\/czbxhsoxyawprqehkfit\.supabase\.co\/functions\/v1\/send-walk-reminders',/);
    expect(source).toMatch(/'x-cron-secret',\s*\(\s*\n\s*select decrypted_secret\s*\n\s*from vault\.decrypted_secrets\s*\n\s*where name = 'walk_reminder_cron_secret'\s*\n\s*\)/);
  });

  it('schedules at the cadence send-walk-reminders itself documents as intended ("roughly once a minute")', () => {
    expect(source).toMatch(/'walkie-send-walk-reminders',\s*\n\s*'\* \* \* \* \*',/);
  });
});
