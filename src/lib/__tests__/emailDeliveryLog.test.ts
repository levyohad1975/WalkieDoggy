describe('email delivery log and provider webhook', () => {
  const fs = require('fs');

  const migration = fs.readFileSync(
    require.resolve('../../../supabase/migrations/0034_email_delivery_log.sql'),
    'utf8'
  );
  const createFamilyEdge = fs.readFileSync(
    require.resolve('../../../supabase/functions/create-verified-family/index.ts'),
    'utf8'
  );
  const webhookEdge = fs.readFileSync(
    require.resolve('../../../supabase/functions/email-provider-webhook/index.ts'),
    'utf8'
  );
  const config = fs.readFileSync(require.resolve('../../../supabase/config.toml'), 'utf8');

  it('creates an append-only delivery log with no client-facing policies', () => {
    expect(migration).toContain('create table if not exists email_delivery_log');
    expect(migration).toContain('alter table email_delivery_log enable row level security');
    expect(migration).not.toMatch(/create policy[^;]*email_delivery_log/i);
    expect(migration).toContain(
      "check (message_type in ('family_welcome', 'system_owner_new_family'))"
    );
    expect(migration).toContain('email_delivery_log_provider_message_id_idx');
  });

  it('gates every mutation RPC to the service role only', () => {
    expect(migration).toContain('function record_email_delivery_attempt(');
    expect(migration).toContain('function update_email_delivery_status(');
    const attemptGuardCount = migration.split("auth.role() <> 'service_role'").length - 1;
    expect(attemptGuardCount).toBe(2);
    expect(migration).toContain(
      'grant execute on function record_email_delivery_attempt(uuid, uuid, text, text, text, text, text, text) to service_role'
    );
    expect(migration).toContain(
      'grant execute on function update_email_delivery_status(text, text, text, text) to service_role'
    );
    expect(migration).not.toContain(
      'grant execute on function record_email_delivery_attempt(uuid, uuid, text, text, text, text, text, text) to authenticated'
    );
  });

  it('gates the observability read RPC on system admin', () => {
    expect(migration).toContain('function system_admin_list_email_delivery_log(');
    expect(migration).toContain('if not is_system_admin() then');
    expect(migration).toContain(
      'grant execute on function system_admin_list_email_delivery_log(integer) to authenticated'
    );
  });

  it('logs every welcome/system-owner send attempt with its outcome', () => {
    expect(createFamilyEdge).toContain("async function sendAndLogEmail(");
    expect(createFamilyEdge).toContain("messageType: 'family_welcome'");
    expect(createFamilyEdge).toContain("messageType: 'system_owner_new_family'");
    expect(createFamilyEdge).toContain("p_status: 'sent'");
    expect(createFamilyEdge).toContain("p_status: 'failed'");
    expect(createFamilyEdge).toContain(".rpc('record_email_delivery_attempt'");
    // Logging must never replace the existing best-effort warnings contract.
    expect(createFamilyEdge).toContain("warnings.push('welcome_email_not_sent')");
    expect(createFamilyEdge).toContain("warnings.push('system_owner_notification_not_sent')");
  });

  it('rejects webhook requests that are missing or fail signature verification', () => {
    expect(webhookEdge).toContain("Deno.env.get('RESEND_WEBHOOK_SECRET')");
    expect(webhookEdge).toContain("svix-id");
    expect(webhookEdge).toContain("svix-timestamp");
    expect(webhookEdge).toContain("svix-signature");
    expect(webhookEdge).toContain("return response(401, { error: 'missing webhook signature' })");
    expect(webhookEdge).toContain("return response(401, { error: 'webhook timestamp out of tolerance' })");
    expect(webhookEdge).toContain("return response(401, { error: 'invalid webhook signature' })");
  });

  it('maps every Resend event type it handles and updates the log by provider message id', () => {
    expect(webhookEdge).toContain("'email.sent': 'sent'");
    expect(webhookEdge).toContain("'email.delivered': 'delivered'");
    expect(webhookEdge).toContain("'email.bounced': 'bounced'");
    expect(webhookEdge).toContain("'email.complained': 'complained'");
    expect(webhookEdge).toContain("admin.rpc('update_email_delivery_status'");
    expect(webhookEdge).toContain("p_provider: 'resend'");
    expect(webhookEdge).toContain("p_provider_message_id: emailId");
  });

  it('compares the webhook signature in constant time instead of a short-circuiting ===', () => {
    expect(webhookEdge).toContain('function timingSafeBase64Equal(');
    expect(webhookEdge).not.toMatch(/\.some\(\(candidate\) => candidate === expected\)/);
    expect(webhookEdge).toContain('.some((candidate) => timingSafeBase64Equal(candidate, expected))');
    // Must decode both sides and XOR-accumulate over every byte, not return
    // early on the first mismatching one.
    expect(webhookEdge).toContain('diff |= candidateBytes[i] ^ expectedBytes[i]');
  });

  it('never trusts the webhook body before signature verification', () => {
    const verifyCallIndex = webhookEdge.indexOf('verifySvixSignature({');
    const jsonParseIndex = webhookEdge.indexOf('JSON.parse(body');
    expect(verifyCallIndex).toBeGreaterThan(-1);
    expect(jsonParseIndex).toBeGreaterThan(verifyCallIndex);
  });

  it('disables platform JWT verification only for the webhook endpoint', () => {
    expect(config).toContain('[functions.email-provider-webhook]');
    expect(config).toMatch(/\[functions\.email-provider-webhook\][^[]*verify_jwt = false/);
  });
});
