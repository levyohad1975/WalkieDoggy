describe('send-email Auth hook', () => {
  const fs = require('fs');

  const source = fs.readFileSync(
    require.resolve('../../../supabase/functions/send-email/index.ts'),
    'utf8'
  );
  const config = fs.readFileSync(require.resolve('../../../supabase/config.toml'), 'utf8');

  it('accepts POST only', () => {
    expect(source).toContain("req.method !== 'POST'");
    expect(source).toContain("new Response('not allowed', { status: 400 })");
  });

  it('verifies the Standard Webhooks signature via the official verifier before trusting the body', () => {
    expect(source).toContain("import { Webhook } from 'npm:standardwebhooks");
    expect(source).toContain("Deno.env.get('SEND_EMAIL_HOOK_SECRET')");
    expect(source).toContain(".replace('v1,whsec_', '')");
    expect(source).toContain('wh.verify(payload, headers)');

    // Search only inside Deno.serve's body -- the file's own top-of-file
    // security-model comment mentions "wh.verify()" and "req.text()" in
    // prose well before either actually appears in code.
    const serveIdx = source.indexOf('Deno.serve(');
    expect(serveIdx).toBeGreaterThan(-1);
    const body = source.slice(serveIdx);

    const textIdx = body.indexOf('await req.text()');
    const verifyIdx = body.indexOf('wh.verify(');
    const tokenUseIdx = body.indexOf('email_data.token');
    expect(textIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeGreaterThan(textIdx);
    expect(tokenUseIdx).toBeGreaterThan(verifyIdx);
  });

  it('rejects an invalid or missing signature with a non-2xx response', () => {
    expect(source).toContain("return jsonErrorResponse(401, 'invalid webhook signature')");
  });

  it('reads the Resend API key from the environment and reports provider failure as non-2xx', () => {
    expect(source).toContain("Deno.env.get('RESEND_API_KEY')");
    expect(source).toContain("return jsonErrorResponse(500, 'email provider failed')");
  });

  it('sends the numeric OTP from email_data.token for signup/OTP flows', () => {
    expect(source).toContain('function templateFor(actionType: string, token: string)');
    expect(source).toContain(
      'templateFor(email_data.email_action_type ?? \'signup\', email_data.token)'
    );
    expect(source).toContain('signup:');
  });

  it('never logs the OTP, hook secret, Resend API key, bearer tokens, or the raw/parsed payload', () => {
    const consoleCalls = source.match(/console\.(log|error|warn|info)\([^]*?\);/g) ?? [];
    expect(consoleCalls.length).toBeGreaterThan(0);
    const forbidden = [
      'token',
      'payload',
      'headers',
      'hookSecret',
      'RESEND_API_KEY',
      'Authorization',
      'SEND_EMAIL_HOOK_SECRET',
      'email_data',
      'user.email',
    ];
    for (const call of consoleCalls) {
      for (const word of forbidden) {
        expect(call).not.toContain(word);
      }
    }
  });

  it('is deployed with platform JWT verification disabled', () => {
    expect(config).toContain('[functions.send-email]');
    expect(config).toMatch(/\[functions\.send-email\][^[]*verify_jwt = false/);
  });
});
