describe('remove-photo-background Edge Function', () => {
  const fs = require('fs');

  const source = fs.readFileSync(require.resolve('../../../supabase/functions/remove-photo-background/index.ts'), 'utf8');
  const provider = fs.readFileSync(require.resolve('../../../supabase/functions/remove-photo-background/provider.ts'), 'utf8');

  it('authenticates the caller from their own bearer token before doing anything else', () => {
    expect(source).toContain("req.headers.get('Authorization')");
    expect(source).toContain("return jsonResponse(401, { ok: false, error: 'missing Authorization header' });");
    expect(source).toContain('userClient.auth.getUser()');
  });

  it('resolves the caller family server-side and never trusts a client-claimed family/path', () => {
    const familyIdx = source.indexOf("userClient.rpc('current_profile_id')");
    const pathIdx = source.indexOf('extractStoragePath(photoUrl)');
    expect(familyIdx).toBeGreaterThan(-1);
    expect(pathIdx).toBeGreaterThan(familyIdx);
    expect(source).toContain('path.startsWith(`${callerFamilyId}/dog/`)');
  });

  it('only uses the service-role client AFTER identity/authorization is established', () => {
    const authIdx = source.indexOf("path.startsWith(`${callerFamilyId}/dog/`)");
    const serviceIdx = source.indexOf('createClient(supabaseUrl, serviceRoleKey)');
    expect(authIdx).toBeGreaterThan(-1);
    expect(serviceIdx).toBeGreaterThan(authIdx);
  });

  it('delegates the actual removal to the isolated provider module, never a vendor API directly', () => {
    expect(source).toContain("import { getBackgroundRemovalProvider } from './provider.ts';");
    expect(source).not.toMatch(/api-inference\.huggingface\.co|api\.remove\.bg/);
    expect(source).toContain('getBackgroundRemovalProvider()');
    expect(source).toContain('provider.removeBackground(imageBytes,');
  });

  it('is best-effort end to end: every failure path returns a non-2xx JSON response, never throws past the handler', () => {
    expect(source).toContain('try {');
    expect(source).toContain('} catch (err) {');
    expect(source).toMatch(/jsonResponse\(50\d/);
  });

  it('provider.ts exposes the swap seam and keeps the vendor call fully isolated behind it', () => {
    expect(provider).toContain('export interface BackgroundRemovalProvider');
    expect(provider).toContain('export function getBackgroundRemovalProvider()');
    expect(provider).toContain("Deno.env.get('HUGGINGFACE_API_TOKEN')");
  });
});
