import fs from 'fs';
import path from 'path';

describe('Home Dashboard dog scene', () => {
  const home = fs.readFileSync(path.resolve(__dirname, '../HomeScreen.tsx'), 'utf8');
  const details = fs.readFileSync(path.resolve(__dirname, '../../components/DogDetailsModal.tsx'), 'utf8');
  const repository = fs.readFileSync(path.resolve(__dirname, '../../data/supabaseRepository.ts'), 'utf8');

  it('uses the persisted family scene and renders only a transparent dog cutout above it', () => {
    expect(home).toContain('getDogBackground(dog?.heroBackgroundId)');
    expect(home).toContain('getDogBackgroundImageSource(heroBackground)');
    expect(home).toContain('const showDogCutout = Boolean(dog?.photoCutoutUrl)');
    expect(home).toContain("source={{ uri: dog!.photoCutoutUrl! }}");
    expect(home).toContain('{!showDogCutout ? (');
    expect(home).not.toContain('source={{ uri: dog!.photoUrl! }}');
    expect(home).not.toContain('dashboardHeroDogPhoto');
    expect(home).toContain('<WalkieMascot state={guestReactionPlaying ?');
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
