import fs from 'fs';
import path from 'path';

describe('Home hero mascot — dog photo cutout priority', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('prefers the cutout, then the raw photo, then the animated brand mascot', () => {
    const cutoutIdx = home.indexOf('hasDogCutout ?');
    const photoIdx = home.indexOf('hasDogPhoto ?', cutoutIdx);
    const mascotIdx = home.indexOf('testID="home-brand-mascot"', photoIdx);
    expect(cutoutIdx).toBeGreaterThan(-1);
    expect(photoIdx).toBeGreaterThan(cutoutIdx);
    expect(mascotIdx).toBeGreaterThan(photoIdx);
    expect(home).toContain('source={{ uri: dog!.photoCutoutUrl }}');
    expect(home).toContain('source={{ uri: dog!.photoUrl }}');
  });

  it('never shows a cutout for a dog that currently has no photo (defense in depth)', () => {
    expect(home).toContain('const hasDogPhoto = Boolean(dog?.photoUrl) && !dogPhotoFailed;');
    expect(home).toContain('const hasDogCutout = hasDogPhoto && Boolean(dog?.photoCutoutUrl) && !dogCutoutFailed;');
  });

  it('falls back a tier immediately on load failure, and resets independently per URL', () => {
    expect(home).toContain('onError={() => setDogCutoutFailed(true)}');
    expect(home).toContain('onError={() => setDogPhotoFailed(true)}');
    expect(home).toMatch(/useEffect\(\(\) => \{\s*setDogPhotoFailed\(false\);\s*\}, \[dog\?\.photoUrl\]\);/);
    expect(home).toMatch(/useEffect\(\(\) => \{\s*setDogCutoutFailed\(false\);\s*\}, \[dog\?\.photoCutoutUrl\]\);/);
  });

  it('renders the cutout in the Hero instead of putting the original photo in a framed image', () => {
    const heroIdx = home.indexOf('style={styles.dashboardHeroMascot}');
    expect(heroIdx).toBeGreaterThan(-1);
    expect(home.indexOf('hasDogCutout ?', heroIdx)).toBeGreaterThan(heroIdx);
    expect(home).not.toContain('dashboardHeroDogPhoto');
  });
});

describe('Settings dog-photo upload — cutout request and invalidation', () => {
  const settings = fs.readFileSync(path.join(__dirname, '..', 'SettingsScreen.tsx'), 'utf8');

  it('clears the previous cutout immediately when a new photo is uploaded, before requesting a new one', () => {
    const uploadIdx = settings.indexOf('photoUrl: uri, photoCutoutUrl: undefined');
    const requestIdx = settings.indexOf('requestDogPhotoCutout(uri)');
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(requestIdx).toBeGreaterThan(uploadIdx);
  });

  it('builds the next dog explicitly rather than patching from stale closure state', () => {
    expect(settings).toContain('const updatedDog: Dog = { ...dog, photoUrl: uri, photoCutoutUrl: undefined };');
    expect(settings).toContain('await saveDog(updatedDog);');
    expect(settings).toContain('await saveDog({ ...updatedDog, photoCutoutUrl: cutoutUrl });');
  });

  it('only requests a cutout when Supabase is configured (no server to call in demo mode)', () => {
    const uploadIdx = settings.indexOf('await saveDog(updatedDog);');
    const guardIdx = settings.indexOf('if (isSupabaseConfigured)', uploadIdx);
    expect(guardIdx).toBeGreaterThan(uploadIdx);
  });
});
