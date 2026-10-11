import fs from 'fs';
import path from 'path';

describe('DogProfileModal — broken photo fallback', () => {
  it('shows Walkie Mascot if an existing dog photo fails to load, and retries a new URL', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../DogProfileModal.tsx'), 'utf8');
    expect(source).toContain('const [photoLoadFailed, setPhotoLoadFailed] = useState(false);');
    expect(source).toContain('}, [dog?.id, dog?.photoUrl]);');
    expect(source).toContain('{displayedPhotoUrl && !photoLoadFailed ? (');
    expect(source).toContain('onError={() => setPhotoLoadFailed(true)}');
    expect(source).toContain('<WalkieMascot');
  });
  it('previews a selected replacement and commits the uploaded URL through the family store', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../DogProfileModal.tsx'), 'utf8');
    expect(source).toContain("pickAndUploadImage('dogs', familyId, dog.id, setPendingPhotoUrl)");
    expect(source).toContain("if (pendingPhotoUrl) await saveDog({ ...dog, photoUrl: pendingPhotoUrl, photoCutoutUrl: undefined });");
  });

  it('removes the saved dog photo through the family store and returns to the official mascot fallback', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../DogProfileModal.tsx'), 'utf8');
    expect(source).toContain('await clearDogPhoto(dog.id)');
    expect(source).toContain('setPendingPhotoUrl(null)');
    expect(source).toContain('<WalkieMascot');
  });

  it('shows the persisted Dog.sex value in the dog profile in Hebrew', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../DogProfileModal.tsx'), 'utf8');
    expect(source).toContain("{dog.sex === 'male' ? 'זכר' : 'נקבה'}");
  });
});
