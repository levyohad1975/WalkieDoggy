import fs from 'fs';
import path from 'path';

describe('Home Dashboard dog scene', () => {
  const home = fs.readFileSync(path.resolve(__dirname, '../HomeScreen.tsx'), 'utf8');
  const details = fs.readFileSync(path.resolve(__dirname, '../../components/DogDetailsModal.tsx'), 'utf8');
  const repository = fs.readFileSync(path.resolve(__dirname, '../../data/supabaseRepository.ts'), 'utf8');

  it('uses the persisted family scene and prefers a transparent dog cutout', () => {
    expect(home).toContain('getDogBackground(dog?.heroBackgroundId)');
    expect(home).toContain('const showDogCutout = Boolean(dog?.photoCutoutUrl)');
    expect(home).toContain("source={{ uri: dog!.photoCutoutUrl! }}");
    expect(home).toContain('!showDogCutout && showPersonalHero');
    expect(home).toContain('!showDogCutout && !showPersonalHero');
  });

  it('makes the same persisted picker available in the normal dog edit flow', () => {
    expect(details).toContain('<DogHeroBackgroundPicker dog={dog} onSave={onSave} />');
    expect(repository).toContain('hero_background_id: dog.heroBackgroundId ?? null');
    expect(repository).toContain('photo_cutout_url: dog.photoCutoutUrl ?? null');
  });
});
