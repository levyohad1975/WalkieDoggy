import fs from 'fs';
import path from 'path';

/**
 * Structural contract for supabase/functions/send-chat-push (Deno — not
 * executed by this repo's Jest run; same source-scan convention as
 * sendRequestPushNoDestination.test.ts) plus the two client-side ends of
 * the same pipeline.
 */
describe('send-chat-push — server-derived, de-duplicated chat notifications (structural)', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const source = fs.readFileSync(path.join(root, 'supabase', 'functions', 'send-chat-push', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
  const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

  it('authenticates the caller from their own bearer token before anything else', () => {
    const getUser = code.indexOf('await userClient.auth.getUser()');
    const serviceClient = code.indexOf('createClient(supabaseUrl, serviceRoleKey)');
    expect(getUser).toBeGreaterThan(-1);
    expect(serviceClient).toBeGreaterThan(getUser);
    expect(code).toContain("return json({ ok: false, error: 'invalid or expired session' }, 401);");
  });

  it('reads exactly one field from the request body — the message id — and validates its shape', () => {
    expect(code).toContain('messageId = (await req.json())?.messageId;');
    expect(code).toContain('!UUID_PATTERN.test(messageId)');
    expect(code).not.toMatch(/body\?\.(recipient|title|userId|senderId|familyId)/);
    expect(code).not.toMatch(/recipientUserIds\s*=\s*body/);
  });

  it('asks the database, AS THE CALLER, whether they authored the message — and stops if not', () => {
    const contextCall = code.indexOf("userClient.rpc('chat_push_context'");
    const claim = code.indexOf("serviceClient.rpc('claim_chat_push_event'");
    expect(contextCall).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(contextCall);
    const between = code.slice(contextCall, claim);
    expect(between).toContain('if (!context) {');
    expect(code).not.toContain("serviceClient.rpc('chat_push_context'");
  });

  it('claims the message once before sending, and reports a duplicate trigger as already sent', () => {
    expect(code).toContain("return json({ ok: true, sent: 0, reason: 'already sent' });");
    const claim = code.indexOf("serviceClient.rpc('claim_chat_push_event'");
    const firstSend = code.indexOf('fetch(EXPO_PUSH_URL');
    expect(firstSend).toBeGreaterThan(claim);
  });

  it('takes recipients from the database and excludes the sender again in code', () => {
    expect(code).toContain("serviceClient.rpc('chat_push_recipients'");
    expect(code).toContain('id !== ctx.sender_user_id');
  });

  it('never reports a zero-destination message as delivered', () => {
    const idx = code.indexOf('if (expoTokens.length === 0 && webSubscriptions.length === 0) {');
    expect(idx).toBeGreaterThan(-1);
    const block = code.slice(idx, idx + 260);
    expect(block).toContain("await mark('no_destination');");
    expect(block).not.toContain("mark('sent')");
  });

  it('sends the payload shape the app routes to the Chat tab, and de-duplicates web destinations', () => {
    expect(code).toContain("const data = { type: 'chat', conversationId: ctx.conversation_id, messageId: ctx.message_id };");
    expect(code).toContain('new Map((webRows ?? []).map((sub: any) => [sub.endpoint, sub]))');
    expect(code).toContain('tag: `chat-${ctx.message_id}`');
    expect(code).toContain('collapseId: `chat-${ctx.message_id}`');
  });

  it('builds the notification text from database values only', () => {
    expect(code).toContain('const title = ctx.sender_name?.trim() || FALLBACK_SENDER;');
    expect(code).toContain('const caption = previewOf(ctx.body);');
    // An image is announced as an image; its path/URL is never part of a push.
    expect(code).toContain('const body = ctx.has_image ? (caption ? `${IMAGE_LABEL}: ${caption}` : IMAGE_LABEL) : caption;');
    expect(code).not.toMatch(/attachment_path|signedUrl|createSignedUrl/);
  });

  it('never logs message text', () => {
    const logLines = code.split('\n').filter((line) => line.includes('console.'));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line).not.toMatch(/ctx\.body|caption|\bbody\b|title/);
    }
  });

  it('the client trigger sends only the message id', () => {
    const client = fs.readFileSync(path.join(root, 'src', 'lib', 'chat.ts'), 'utf8');
    expect(client).toContain("supabase.functions.invoke('send-chat-push', { body: { messageId } })");
  });

  it('the service worker gives every tagged chat message an independent visible notification', () => {
    const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
    expect(sw).toContain("if (typeof payload.tag === 'string' && payload.tag) {");
    expect(sw).toContain('options.tag = payload.tag;');
    expect(sw).toContain('options.renotify = true;');
    expect(sw).toContain('every message uniquely');
    // The pre-existing options are untouched.
    expect(sw).toContain("icon: '/icon-192.png',");
    expect(sw).toContain('data: payload.data || {},');
  });
});
