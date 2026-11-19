import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: auth, error: authError } = await caller.auth.getUser();
    if (authError || !auth.user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json();
    const familyId = String(body?.familyId ?? ''); const conversationId = String(body?.conversationId ?? '');
    const messageId = String(body?.messageId ?? ''); const reason = body?.reason;
    if (![familyId, conversationId, messageId].every((x) => /^[0-9a-f-]{36}$/i.test(x)) || !['support','incident','policy_review'].includes(reason)) return json({ error: 'invalid_request' }, 400);
    const { data: path, error: authorizeError } = await caller.rpc('system_admin_prepare_chat_attachment', {
      p_family_id: familyId, p_conversation_id: conversationId, p_message_id: messageId, p_reason: reason,
    });
    if (authorizeError || typeof path !== 'string') return json({ error: 'forbidden_or_missing' }, 403);
    // Service role is server-only and used only after the authenticated, audited, family/conversation/message-scoped RPC.
    const privileged = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await privileged.storage.from('chat-attachments').createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return json({ error: 'attachment_unavailable' }, 404);
    return json({ signedUrl: data.signedUrl });
  } catch {
    return json({ error: 'request_failed' }, 400);
  }
});
