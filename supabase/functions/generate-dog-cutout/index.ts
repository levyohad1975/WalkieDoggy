import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { analyzePngTransparency } from "../_shared/pngTransparency.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

Deno.serve(async (req: Request) => {
  // Safari/web clients preflight the function call. Without this, the browser
  // blocks the POST and no cutout job reaches the function.
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: jsonHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: jsonHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "server_not_configured" }), { status: 500, headers: jsonHeaders });
  }

  let body: { dogId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: jsonHeaders });
  }
  if (!body.dogId) {
    return new Response(JSON.stringify({ error: "dog_id_required" }), { status: 400, headers: jsonHeaders });
  }

  // Query through the caller's JWT/RLS first. If this dog is not visible to
  // the authenticated family member, processing is refused before the
  // service-role client is ever used.
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: dog, error: dogError } = await caller
    .from("dogs")
    .select("id,family_id,photo_url,photo_cutout_url")
    .eq("id", body.dogId)
    .maybeSingle();

  if (dogError || !dog) {
    return new Response(JSON.stringify({ error: "dog_not_found" }), { status: 404, headers: jsonHeaders });
  }
  // This function later uses a service-role client, which bypasses RLS. Row
  // visibility proves family membership only; explicitly authorize the real
  // family admin first. is_family_admin() also denies active impersonation.
  const { data: callerIsAdmin, error: roleError } = await caller.rpc("is_family_admin", {
    target_family_id: dog.family_id,
  });
  if (roleError || callerIsAdmin !== true) {
    return new Response(JSON.stringify({ error: "admin_permission_required" }), { status: 403, headers: jsonHeaders });
  }
  if (!dog.photo_url) {
    return new Response(JSON.stringify({ error: "dog_has_no_photo" }), { status: 409, headers: jsonHeaders });
  }

  // Fetch the public family photo and send it to the staging background
  // removal processor. BGNinja exposes a keyless endpoint; keeping this call
  // here (rather than in the app) lets us replace the processor later without
  // changing clients. Production promotion must separately review provider,
  // privacy and capacity.
  const source = await fetch(dog.photo_url);
  if (!source.ok) {
    return new Response(JSON.stringify({ error: "source_photo_unavailable" }), { status: 502, headers: jsonHeaders });
  }
  const sourceType = source.headers.get("content-type") ?? "image/jpeg";
  if (!sourceType.startsWith("image/")) {
    return new Response(JSON.stringify({ error: "source_not_image" }), { status: 415, headers: jsonHeaders });
  }
  const sourceBytes = await source.arrayBuffer();
  if (sourceBytes.byteLength > 10 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: "source_too_large" }), { status: 413, headers: jsonHeaders });
  }

  const processed = await requestBackgroundRemoval(sourceBytes, sourceType);
  if (!processed.ok) {
    return new Response(JSON.stringify({ error: processed.error }), { status: processed.status, headers: jsonHeaders });
  }
  const png = processed.png;

  // Never persist a "cutout" without verifying it. The Home hero composites
  // this file directly over the family background, so an opaque result (the
  // provider returning the original, a solid-background PNG, a JPEG, etc.)
  // would render as a rectangle with the original background. Rejecting here
  // leaves photo_url untouched and the dog row without a cutout, so Home
  // keeps the mascot fallback and the family can retry.
  const verdict = await analyzePngTransparency(png, inflateChunks);
  if (!verdict.ok) {
    console.error("background removal output rejected", verdict.reason, verdict.stats ?? null);
    return new Response(
      JSON.stringify({ error: "cutout_not_transparent", reason: verdict.reason }),
      { status: 422, headers: jsonHeaders },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const path = `${dog.family_id}/dog/cutouts/${dog.id}-${crypto.randomUUID()}.png`;
  const { error: uploadError } = await admin.storage
    .from("family-photos")
    .upload(path, png, { contentType: "image/png", upsert: false, cacheControl: "31536000" });
  if (uploadError) {
    console.error("cutout upload failed", uploadError);
    return new Response(JSON.stringify({ error: "cutout_upload_failed" }), { status: 500, headers: jsonHeaders });
  }

  const { data: publicData } = admin.storage.from("family-photos").getPublicUrl(path);
  const cutoutUrl = publicData.publicUrl;

  // Optimistic concurrency guard: only attach this cutout if photo_url is
  // still the same source we processed. A second upload racing this job must
  // never receive the first upload's cutout.
  const { data: updated, error: updateError } = await admin
    .from("dogs")
    .update({ photo_cutout_url: cutoutUrl })
    .eq("id", dog.id)
    .eq("photo_url", dog.photo_url)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    await admin.storage.from("family-photos").remove([path]);
    return new Response(JSON.stringify({ error: "source_photo_changed" }), { status: 409, headers: jsonHeaders });
  }

  // Best-effort cleanup of the previous generated cutout after the new one
  // is safely attached. Source photos are never deleted here.
  if (dog.photo_cutout_url) {
    try {
      const prefix = `${supabaseUrl}/storage/v1/object/public/family-photos/`;
      if (dog.photo_cutout_url.startsWith(prefix)) {
        const oldPath = decodeURIComponent(dog.photo_cutout_url.slice(prefix.length));
        if (oldPath.includes("/dog/cutouts/")) await admin.storage.from("family-photos").remove([oldPath]);
      }
    } catch {
      // Non-critical orphan cleanup only.
    }
  }

  return new Response(JSON.stringify({ cutoutUrl }), { status: 200, headers: jsonHeaders });
});

type RemovalResult =
  | { ok: true; png: Uint8Array }
  | { ok: false; status: number; error: string };

// BGNinja (keyless, staging-only): POST multipart `file`; omitting `bg`
// yields a transparent PNG. Documented limits: 2 concurrent requests and a
// small daily quota per egress IP (402 when exhausted, 429 when busy).
async function requestBackgroundRemoval(sourceBytes: ArrayBuffer, sourceType: string): Promise<RemovalResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const form = new FormData();
    form.append("file", new Blob([sourceBytes], { type: sourceType }), "dog-photo");
    let response: Response;
    try {
      response = await fetch("https://bgninja.com/api/remove", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      console.error("background removal provider unreachable", String(error));
      return { ok: false, status: 502, error: "background_removal_failed" };
    }

    if (response.status === 429 && attempt === 0) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    if (!response.ok) {
      const providerBody = (await response.text()).slice(0, 300);
      console.error("background removal provider failed", response.status, providerBody);
      if (response.status === 402) return { ok: false, status: 503, error: "background_removal_quota_exhausted" };
      if (response.status === 429) return { ok: false, status: 503, error: "background_removal_busy" };
      return { ok: false, status: 502, error: "background_removal_failed" };
    }

    const png = new Uint8Array(await response.arrayBuffer());
    if (png.byteLength === 0) return { ok: false, status: 502, error: "empty_cutout" };
    return { ok: true, png };
  }
  return { ok: false, status: 503, error: "background_removal_busy" };
}

async function* inflateChunks(zlibData: Uint8Array): AsyncIterable<Uint8Array> {
  // Copy into a plain ArrayBuffer-backed view (BlobPart typing / no SharedArrayBuffer).
  const stream = new Blob([new Uint8Array(zlibData)]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
