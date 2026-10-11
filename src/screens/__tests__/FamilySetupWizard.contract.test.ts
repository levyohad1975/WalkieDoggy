import fs from 'fs';
import path from 'path';

describe('new family setup wizard contract', () => {
  const wizard = fs.readFileSync(path.resolve(__dirname, '../FamilySetupWizard.tsx'), 'utf8');
  const onboarding = fs.readFileSync(path.resolve(__dirname, '../FamilyOnboardingScreen.tsx'), 'utf8');
  const app = fs.readFileSync(path.resolve(__dirname, '../../../App.tsx'), 'utf8');
  const dogPhoto = fs.readFileSync(path.resolve(__dirname, '../../components/DogPhoto.tsx'), 'utf8');

  it('requires a dog name, persists photos through the shared upload/store path and keeps the mascot fallback', () => {
    expect(wizard).toContain("if (!name) {");
    expect(wizard).toContain('await savePrimaryDog(name, pendingDogPhotoUrl, dogSex)');
    expect(wizard).toContain("pickAndUploadImage('dogs', familyId, dogIdRef.current, (uri) => setSelectedDogPhotoPreviewUrl(uri ?? undefined))");
    expect(wizard).toContain("takeAndUploadImage('dogs', familyId, dogIdRef.current)");
    expect(wizard).toContain('await saveDog(savedDog)');
    expect(wizard).toContain('const userId = progress.adminUserId ?? generateId');
    expect(dogPhoto).toContain('<WalkieMascot state="idle"');
  });

  it('supports back/forward, family members, invite later, editable walks, and direct completion', () => {
    expect(wizard).toContain('שלב {step} מתוך 5');
    expect(wizard).toContain('חזרה');
    expect(wizard).toContain('הזמנה אחר כך');
    expect(wizard).toContain('<UserFormModal');
    expect(wizard).toContain('<FamilySharingModal');
    expect(wizard).toContain('updateRule(editingRuleId');
    expect(wizard).toContain('אגדיר טיולים אחר כך');
    expect(wizard).toContain('בואו נתחיל!');
    expect(wizard).toContain('if (busyRef.current) return;');
    expect(wizard).toContain('לא הצלחנו לטעון את ההקמה');
    expect(wizard).toContain('onPress={() => void refreshData()}');
  });

  it('prevents duplicate family creation and persists a recovery marker before the request', () => {
    expect(onboarding).toContain('if (!familyName.trim() || !verifiedAdminEmail || creatingRef.current) return;');
    expect(onboarding).toContain('await markFamilyCreationPending(identity.userId);');
    expect(onboarding).toContain('await createVerifiedFamily(');
    expect(onboarding).toContain('שלב 1 מתוך 5');
  });

  it('keeps existing-family join separate and gates setup only for this family admin', () => {
    expect(onboarding).toContain("setMode('join')");
    expect(onboarding).toContain('await joinFamily(code.trim())');
    expect(onboarding).toContain('await setFamilyId(family.id)');
    expect(app).toContain('familySetupProgress.familyId === familyId && familyRole === \'admin\'');
    expect(app).toContain('<FamilySetupWizard');
  });

  it('never loads the legacy welcome artwork containing a generic dog illustration', () => {
    expect(onboarding).not.toMatch(/onboarding-welcome-(?:final|wink)\.(?:png|jpe?g)/);
    expect(onboarding).toContain('הקמע הרשמי של Walkie Doggy');
    expect(onboarding).not.toMatch(/🐶|🐕|🦮|🐩/u);
  });
});
