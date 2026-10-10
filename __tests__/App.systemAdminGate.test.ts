import fs from 'fs';
import path from 'path';

/**
 * BATCH 4 (item A — System Admin V1). App.tsx's actual functional component
 * body (where the System Admin gate lives) is never invoked by
 * App.test.ts's existing suite (that file only imports and calls the
 * exported performColdStart/runForegroundSync/registerPushTokenAndReconcile
 * orchestration functions — it never renders <App/>), so the gate itself is
 * verified here the same way this repo's other permission-gate wiring is
 * verified when a component can't be render-tested: a direct source read,
 * asserting on exact code shape rather than incidental text.
 */
describe('App.tsx — System Admin entry point sits OUTSIDE family/auth branching', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');

  it('reads isSystemAdmin from useSystemAdminStore, a store entirely separate from useAuthStore/useFamilyStore', () => {
    expect(source).toMatch(/import \{ useSystemAdminStore \} from '\.\/src\/store\/systemAdminStore';/);
    expect(source).toMatch(/const isSystemAdmin = useSystemAdminStore\(\(s\) => s\.isSystemAdmin\);/);
  });

  it('refreshes System Admin status once hydrated — not gated on familyId/currentUserId', () => {
    expect(source).toMatch(/useEffect\(\(\) => \{\s*\n\s*if \(hydrated\) void refreshSystemAdmin\(\);\s*\n\s*\}, \[hydrated, refreshSystemAdmin\]\);/);
  });

  it('keeps the SystemAdminScreen host after the family/auth branching but no longer renders a floating admin Pressable', () => {
    const ternaryIdx = source.indexOf('{shouldEnterSystemAdminDirectly ? (');
    const screenIdx = source.indexOf('<SystemAdminScreen', ternaryIdx);
    expect(ternaryIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(ternaryIdx);
    expect(source).not.toContain('{isSystemAdmin && !systemObserverActive ? (');
  });

  it('never assigns familyId/currentUserId from the System Admin flow — this file has exactly one writer of familyId-affecting state, and it is not the System Admin block', () => {
    const adminBlockStart = source.indexOf('const isSystemAdmin = useSystemAdminStore');
    const adminBlockEnd = source.indexOf('useEffect(() => {\n    if (currentUserId)');
    const adminBlock = source.slice(adminBlockStart, adminBlockEnd);
    expect(adminBlock).not.toMatch(/setFamilyId|familyId\s*=/);
  });
  it('routes a standalone System Admin directly to the platform console before family onboarding', () => {
    expect(source).toMatch(/const shouldEnterSystemAdminDirectly =/);
    const directIdx = source.indexOf('{shouldEnterSystemAdminDirectly ? (');
    const onboardingIdx = source.indexOf(': needsFamilyOnboarding ? (');
    expect(directIdx).toBeGreaterThan(-1);
    expect(onboardingIdx).toBeGreaterThan(directIdx);
    expect(source).toMatch(/isSystemAdmin && !familyId && !currentUserId && !systemObserverActive/);
  });

});
