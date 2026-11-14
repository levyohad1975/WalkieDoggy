// supabase/functions/web-push-public-key/index.ts
//
// Returns the VAPID PUBLIC key the push functions sign with
// (send-chat-push, send-request-push, send-walk-reminders, ...), so the web
// client subscribes with exactly the key the server will use.
//
// Production incident 2026-11-01: the web build's EXPO_PUBLIC_VAPID_PUBLIC_KEY
// differed from the Edge Functions' VAPID_PUBLIC_KEY secret, so Apple rejected
// every push with 400 {"reason":"VapidPkHashMismatch"}. Reading the key from
// the server removes that second, drift-prone copy.
//
// The VAPID public key is public by design (every browser that subscribes
// receives it). The private key is never read or returned here.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const publicKey = (Deno.env.get('VAPID_PUBLIC_KEY') ?? '').trim();
  return new Response(JSON.stringify(publicKey ? { publicKey } : { publicKey: null }), {
    status: publicKey ? 200 : 503,
    headers: { ...corsHeaders, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
