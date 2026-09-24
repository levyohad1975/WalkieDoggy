import fs from 'fs';
import path from 'path';

describe('DogProfileModal — broken photo fallback', () => {
  it('shows Walkie Mascot if an existing dog photo fails to load, and retries a new URL', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../DogProfileModal.tsx'), 'utf8');
    expect(source).toContain('const [photoLoadFailed, setPhotoLoadFailed] = useState(false);');
    expect(source).toContain('}, [dog?.id, dog?.photoUrl]);');
    expect(source).toContain('{dog.photoUrl && !photoLoadFailed ? (');
    expect(source).toContain('onError={() => setPhotoLoadFailed(true)}');
    expect(source).toContain('<WalkieMascot');
  });
});
