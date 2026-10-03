import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

  const form = new FormData();
  form.append("file", new Blob([sourceBytes], { type: sourceType }), "dog-photo");
  const processed = await fetch("https://bgninja.com/api/remove", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!processed.ok) {
    const providerBody = (await processed.text()).slice(0, 300);
    console.error("background removal provider failed", processed.status, providerBody);
    return new Response(JSON.stringify({ error: "background_removal_failed" }), { status: 502, headers: jsonHeaders });
  }

  const png = await processed.arrayBuffer();
  if (png.byteLength === 0) {
    return new Response(JSON.stringify({ error: "empty_cutout" }), { status: 502, headers: jsonHeaders });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const path = `${dog.family_id}/dog/cutouts/${dog.id}-${Date.now()}.png`;
  const { error: uploadError } = await admin.storage
    .from("family-photos")
    .upload(path, png, { contentType: "image/png", upsert: false });
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
