import fs from 'fs';
import path from 'path';

describe('Home Dashboard dog scene', () => {
  const home = fs.readFileSync(path.resolve(__dirname, '../HomeScreen.tsx'), 'utf8');
  const details = fs.readFileSync(path.resolve(__dirname, '../../components/DogDetailsModal.tsx'), 'utf8');
  const repository = fs.readFileSync(path.resolve(__dirname, '../../data/supabaseRepository.ts'), 'utf8');
  const backgrounds = fs.readFileSync(path.resolve(__dirname, '../../theme/dogBackgrounds.ts'), 'utf8');

  it('uses the persisted family scene and renders only a transparent dog cutout above it', () => {
    expect(home).toContain('getDogBackground(dog?.heroBackgroundId)');
    expect(home).toContain('getDogBackgroundImageSource(heroBackground)');
    expect(home).toContain('const showDogCutout = Boolean(dog?.photoCutoutUrl) && !heroCutoutFailed;');
    expect(home).toContain('onError={() => setHeroCutoutFailed(true)}');
    expect(home).toContain("source={{ uri: dog!.photoCutoutUrl! }}");
    expect(home).toContain('{!showDogCutout ? (');
    expect(home).not.toContain('source={{ uri: dog!.photoUrl! }}');
    expect(home).not.toContain('dashboardHeroDogPhoto');
    expect(home).toContain('<WalkieMascot state={guestReactionPlaying ?');
  });

  it('fits the photo background to a 2:1 iPhone hero and fades into the existing cream surface', () => {
    expect(backgrounds).toContain('w=1200&h=600');
    expect(home).toContain('resizeMode="cover"');
    expect(home).toContain("dashboardHeroImage: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' }");
    expect(home).toContain('dashboardHeroFade: { position: \'absolute\', left: 0, right: 0, bottom: 0, height: 44, zIndex: 1 }');
    expect(home).toContain('stopColor={colors.background}');
    expect(home).toContain('height: 148,');
    expect(home).toContain('bottom: -14');
    expect(home).toContain('overflow: \'hidden\'');
  });

  it('makes the same persisted picker available in the normal dog edit flow', () => {
    expect(details).toContain('<DogHeroBackgroundPicker dog={dog} onSave={onSave} />');
    expect(repository).toContain('hero_background_id: dog.heroBackgroundId ?? null');
    expect(repository).toContain('photo_cutout_url: dog.photoCutoutUrl ?? null');
  });

  it('preserves both default and selected backgrounds while dog images remain separate persisted fields', () => {
    expect(home).toContain('getDogBackground(dog?.heroBackgroundId)');
    expect(repository).toContain('photo_url: dog.photoUrl ?? null');
    expect(repository).toContain('hero_background_id: dog.heroBackgroundId ?? null');
    expect(repository).toContain('photo_cutout_url: dog.photoCutoutUrl ?? null');
  });
});
