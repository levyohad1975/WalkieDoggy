// supabase/functions/chat-attachment-cleanup/index.ts
//
// Physically removes chat image files that no longer belong to a live
// message (migration 0109_private_chat_and_images.sql):
//   * attachments of removed messages (queued in chat_attachment_deletions
//     by chat_delete_message());
//   * uploads older than a day that never became a message (a cancelled or
//     crashed send the device did not clean up itself).
//
// WHAT TO REMOVE is decided entirely by the database
// (chat_attachment_cleanup_batch(), service role). The request carries no
// path, no id and no parameters, so a caller cannot make this function
// delete anything in particular — it can only ask "run the cleanup now".
// Access to a removed message's image is already revoked the moment the
// message is removed (chat_attachment_readable); this function only frees
// the storage.
//
// CALLERS
//   * any signed-in member, right after removing a message (best-effort);
//   * a scheduler, with the x-cron-secret header (CHAT_CLEANUP_CRON_SECRET).
//
// Files are deleted through the Storage API, not by deleting rows from
// storage.objects, so the stored object itself is removed as well.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'chat-attachments';
const BATCH_SIZE = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cronSecret = Deno.env.get('CHAT_CLEANUP_CRON_SECRET') ?? '';

    const presentedSecret = req.headers.get('x-cron-secret') ?? '';
    const isScheduler = cronSecret.length > 0 && presentedSecret === cronSecret;

    if (!isScheduler) {
      const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
      if (!authHeader) {
        return json({ ok: false, error: 'missing Authorization header' }, 401);
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData?.user) {
        return json({ ok: false, error: 'invalid or expired session' }, 401);
      }
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: batch, error: batchError } = await serviceClient.rpc('chat_attachment_cleanup_batch', {
      p_limit: BATCH_SIZE,
    });
    if (batchError) throw batchError;

    const paths = [
      ...new Set(
        ((batch ?? []) as unknown[])
          .map((row) => (typeof row === 'string' ? row : (row as { chat_attachment_cleanup_batch?: string })?.chat_attachment_cleanup_batch))
          .filter((path): path is string => typeof path === 'string' && path.length > 0)
      ),
    ];
    if (paths.length === 0) {
      return json({ ok: true, removed: 0 });
    }

    const { error: removeError } = await serviceClient.storage.from(BUCKET).remove(paths);
    if (removeError) {
      // Counts only — never paths.
      console.error('chat-attachment-cleanup: storage removal failed', { count: paths.length, message: removeError.message });
      return json({ ok: false, removed: 0 });
    }

    const { error: markError } = await serviceClient.rpc('chat_attachment_mark_removed', { p_paths: paths });
    if (markError) throw markError;

    return json({ ok: true, removed: paths.length });
  } catch (err) {
    console.error('chat-attachment-cleanup failed', String((err as { message?: string })?.message ?? err));
    return json({ ok: false, error: 'cleanup failed' });
  }
});
