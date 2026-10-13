import fs from 'fs';
import path from 'path';

describe('DogPhoto identity rule', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../DogPhoto.tsx'), 'utf8');

  it('keeps generic dog emoji and retired dog-art files out of production UI source', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') visit(fullPath);
        } else if (/\.(?:tsx?|jsx?)$/u.test(entry.name)) {
          files.push(fullPath);
        }
      }
    };
    visit(path.join(repoRoot, 'src'));
    visit(path.join(repoRoot, 'supabase', 'functions'));
    files.push(path.join(repoRoot, 'App.tsx'));
    const productionSource = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

    expect(productionSource).not.toMatch(/🐶|🐕|🦮|🐩|🐾|🦴/u);
    expect(productionSource).not.toMatch(/walkie-guest-celebration\.webp|onboarding-welcome-(?:final|wink)\.png/u);
    expect(fs.readFileSync(path.join(repoRoot, 'supabase', 'seed.sql'), 'utf8')).not.toMatch(/🐶|🐕|🦮|🐩|🐾|🦴/u);
  });

  it('uses a family photo when available and only the official WalkieMascot otherwise', () => {
    expect(source).toContain("import { WalkieMascot } from './WalkieMascot';");
    expect(source).toContain('const showPhoto = Boolean(photoUrl) && !failed;');
    expect(source).toContain('<Image');
    expect(source).toContain('<WalkieMascot state="idle"');
    expect(source).not.toMatch(/require\([^)]*(?:dog|puppy|placeholder)[^)]*\)/i);
    expect(source).not.toMatch(/🐶|🐕|🦮/u);
  });

  it('recovers from an earlier broken URL when a new family photo is selected', () => {
    expect(source).toContain('useEffect(() => setFailed(false), [photoUrl]);');
    expect(source).toContain('onError={() => setFailed(true)}');
  });

  it('has no image-based fallback for loading, missing, removed, or failed photos', () => {
    const fallback = source.slice(source.indexOf(') : ('), source.indexOf('</View>'));
    expect(fallback).toContain('<WalkieMascot');
    expect(fallback).not.toContain('<Image');
  });

  it('audits the app entry and profile surfaces for the retired generic welcome dog artwork', () => {
    const onboarding = fs.readFileSync(path.resolve(__dirname, '../../screens/FamilyOnboardingScreen.tsx'), 'utf8');
    const dashboard = fs.readFileSync(path.resolve(__dirname, '../../screens/HomeScreen.tsx'), 'utf8');
    const profile = fs.readFileSync(path.resolve(__dirname, '../DogProfileModal.tsx'), 'utf8');
    const admin = fs.readFileSync(path.resolve(__dirname, '../../screens/SystemAdminScreen.tsx'), 'utf8');
    expect(onboarding).not.toMatch(/onboarding-welcome-(?:final|wink)\.png/);
    expect(onboarding).toContain('הקמע הרשמי של Walkie Doggy');
    expect(dashboard).toContain('<WalkieMascot state="idle"');
    expect(profile).toContain('<WalkieMascot');
    expect(profile).toContain('onError={() => setPhotoLoadFailed(true)}');
    expect(dashboard).not.toContain('walkie-guest-celebration.webp');
    expect(dashboard).toContain("guestReactionPlaying ? 'excited' : 'idle'");
    expect(admin).not.toContain('walkie-guest-celebration.webp');
    expect(admin).toContain('state="excited"');
  });
});
