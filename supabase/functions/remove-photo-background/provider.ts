// deno-lint-ignore-file no-explicit-any
// @ts-nocheck -- Deno/Edge Function runtime globals (Deno.env) are not
// available in this repo's Node/RN TypeScript project config; this file is
// only ever executed by `supabase functions deploy`, never bundled by
// Metro/tsc for the app.

/**
 * Background-removal provider abstraction. The Edge Function handler
 * (index.ts) only ever talks to this interface — never to a specific
 * vendor's API directly — so the provider can be swapped without touching
 * auth, Storage, or request handling. Approved provider: a self-hosted
 * `rembg` service (isnet-general-use model) — $0 per-image, no managed
 * inference API, no BRIA/remove.bg — running rembg's own HTTP server
 * (`rembg s`) on free hosting (e.g. a Hugging Face Space or Render free web
 * service) that this function is configured to call.
 */
export interface BackgroundRemovalProvider {
  /** Takes the original photo's bytes, returns a transparent-background PNG's bytes. Throws on any failure — the caller treats this as best-effort and never lets it break the upload flow. */
  removeBackground(imageBytes: Uint8Array, contentType: string): Promise<Uint8Array>;
}

const REMBG_MODEL = 'isnet-general-use';

const selfHostedRembgProvider: BackgroundRemovalProvider = {
  async removeBackground(imageBytes, contentType) {
    const serviceUrl = Deno.env.get('REMBG_SERVICE_URL');
    if (!serviceUrl) {
      throw new Error('remove-photo-background: REMBG_SERVICE_URL is not configured');
    }
    const token = Deno.env.get('REMBG_SERVICE_TOKEN');

    // rembg's built-in HTTP server (`rembg s`) exposes POST /api/remove,
    // accepting the image as multipart form-data plus a `model` field —
    // see https://github.com/danielgatis/rembg#usage-as-a-http-server.
    const form = new FormData();
    form.append('model', REMBG_MODEL);
    form.append('file', new Blob([imageBytes], { type: contentType }), 'photo');

    const response = await fetch(`${serviceUrl.replace(/\/+$/, '')}/api/remove`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!response.ok) {
      throw new Error(`remove-photo-background: provider request failed (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  },
};

/**
 * Single seam for swapping providers later: write a second object
 * implementing BackgroundRemovalProvider and return it here instead — no
 * other file needs to change.
 */
export function getBackgroundRemovalProvider(): BackgroundRemovalProvider {
  return selfHostedRembgProvider;
}
