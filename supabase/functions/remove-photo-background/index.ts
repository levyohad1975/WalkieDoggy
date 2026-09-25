// supabase/functions/remove-photo-background/index.ts
//
// Best-effort transparent-cutout generation for an already-uploaded dog
// photo. Called by the client (src/lib/backgroundRemoval.ts) right after
// pickAndUploadImage() finishes uploading the raw photo to the
// `family-photos` Storage bucket.
//
// SECURITY MODEL (mirrors send-request-push/index.ts): this function runs
// with the project's SERVICE ROLE key, which bypasses RLS. The client sends
// only `photoUrl` — never trusted for authorization on its own. The caller's
// identity and family are resolved server-side from their own bearer token,
// and the Storage path parsed out of `photoUrl` is checked against that
// caller's own family folder (the same first-path-segment rule Storage RLS
// already enforces for uploads — see supabase/migrations/0002_*.sql and
// src/lib/uploadImage.ts's doc comment) before this function will touch it.
//
// The actual background-removal call is fully isolated in ./provider.ts —
// this file never talks to a specific vendor's API directly, so the
// provider can be replaced (e.g. by a self-hosted `rembg` service) without
// any change here.
//
// Best-effort semantics: any failure (missing config, provider error,
// unreadable photo) is returned as `{ ok: false }` with a non-2xx status
// rather than thrown past this handler — the caller (src/lib/
// backgroundRemoval.ts) treats any non-success response as "no cutout this
// time" and the app keeps working with the original photo/mascot.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck -- Deno/Edge Function runtime globals (Deno.serve, Deno.env)
// are not available in this repo's Node/RN TypeScript project config; this
// file is only ever executed by `supabase functions deploy`, never bundled
// by Metro/tsc for the app.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getBackgroundRemovalProvider } from './provider.ts';

const BUCKET = 'family-photos';
const PUBLIC_URL_MARKER = `/object/public/${BUCKET}/`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Extracts the Storage object path (e.g. "{familyId}/dog/123.jpg") from a `family-photos` public URL. Never trusts a client-supplied path directly. */
function extractStoragePath(photoUrl: string): string | null {
  const idx = photoUrl.indexOf(PUBLIC_URL_MARKER);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(photoUrl.slice(idx + PUBLIC_URL_MARKER.length));
  } catch {
    return null;
  }
}

function contentTypeForPath(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'method not allowed' });
  }

  try {
    // ---- Step 1: authenticate the caller from their own bearer token ----
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    if (!authHeader) {
      return jsonResponse(401, { ok: false, error: 'missing Authorization header' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) {
      return jsonResponse(401, { ok: false, error: 'invalid or expired session' });
    }

    // ---- Step 2: resolve caller's family server-side ----
    const { data: callerUserId, error: profileError } = await userClient.rpc('current_profile_id');
    if (profileError || !callerUserId) {
      return jsonResponse(403, { ok: false, error: 'no active profile for this session' });
    }

    const { data: callerRow, error: callerRowError } = await userClient
      .from('users')
      .select('family_id')
      .eq('id', callerUserId)
      .single();
    if (callerRowError || !callerRow) {
      return jsonResponse(403, { ok: false, error: 'could not resolve caller family' });
    }
    const callerFamilyId = callerRow.family_id as string;

    // ---- Step 3: parse and authorize the requested photo path ----
    const body = await req.json().catch(() => null);
    const photoUrl: string | undefined = body?.photoUrl;
    if (!photoUrl || typeof photoUrl !== 'string') {
      return jsonResponse(400, { ok: false, error: 'photoUrl is required' });
    }

    const path = extractStoragePath(photoUrl);
    if (!path || !path.startsWith(`${callerFamilyId}/dog/`)) {
      return jsonResponse(403, { ok: false, error: "photoUrl is not in the caller's own family folder" });
    }

    // ---- Step 4: download the original, run it through the provider, upload the cutout ----
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: original, error: downloadError } = await serviceClient.storage.from(BUCKET).download(path);
    if (downloadError || !original) {
      return jsonResponse(502, { ok: false, error: 'could not read the original photo' });
    }
    const imageBytes = new Uint8Array(await original.arrayBuffer());

    const provider = getBackgroundRemovalProvider();
    const cutoutBytes = await provider.removeBackground(imageBytes, contentTypeForPath(path));

    const cutoutPath = path.replace(/\.[a-zA-Z0-9]+$/, '-cutout.png');
    const { error: uploadError } = await serviceClient.storage
      .from(BUCKET)
      .upload(cutoutPath, cutoutBytes, { contentType: 'image/png', upsert: true });
    if (uploadError) {
      return jsonResponse(502, { ok: false, error: 'could not store the cutout' });
    }

    const { data: publicUrlData } = serviceClient.storage.from(BUCKET).getPublicUrl(cutoutPath);
    return jsonResponse(200, { ok: true, cutoutUrl: publicUrlData.publicUrl });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: err instanceof Error ? err.message : 'unknown error' });
  }
});
