// deno-lint-ignore-file no-explicit-any
// @ts-nocheck -- Deno/Edge Function runtime globals (Deno.env) are not
// available in this repo's Node/RN TypeScript project config; this file is
// only ever executed by `supabase functions deploy`, never bundled by
// Metro/tsc for the app.

/**
 * Background-removal provider abstraction. The Edge Function handler
 * (index.ts) only ever talks to this interface — never to a specific
 * vendor's API directly — so the provider can be swapped (e.g. for a
 * self-hosted `rembg` service) without touching auth, Storage, or request
 * handling. Approved provider: Hugging Face Inference API running
 * briaai/RMBG-1.4 (see docs/engineering/ for the cost/privacy tradeoffs
 * that were compared before choosing it).
 */
export interface BackgroundRemovalProvider {
  /** Takes the original photo's bytes, returns a transparent-background PNG's bytes. Throws on any failure — the caller treats this as best-effort and never lets it break the upload flow. */
  removeBackground(imageBytes: Uint8Array, contentType: string): Promise<Uint8Array>;
}

const HUGGING_FACE_MODEL_URL = 'https://api-inference.huggingface.co/models/briaai/RMBG-1.4';

const huggingFaceRmbgProvider: BackgroundRemovalProvider = {
  async removeBackground(imageBytes, contentType) {
    const token = Deno.env.get('HUGGINGFACE_API_TOKEN');
    if (!token) {
      throw new Error('remove-photo-background: HUGGINGFACE_API_TOKEN is not configured');
    }
    const response = await fetch(HUGGING_FACE_MODEL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: imageBytes,
    });
    if (!response.ok) {
      throw new Error(`remove-photo-background: provider request failed (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  },
};

/**
 * Single seam for swapping providers later (e.g. self-hosted `rembg`):
 * write a second object implementing BackgroundRemovalProvider and return
 * it here instead — no other file needs to change.
 */
export function getBackgroundRemovalProvider(): BackgroundRemovalProvider {
  return huggingFaceRmbgProvider;
}
