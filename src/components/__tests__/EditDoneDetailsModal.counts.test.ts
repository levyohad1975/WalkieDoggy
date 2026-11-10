import fs from 'fs';

/**
 * Field report 2026-11-05: pee/poop COUNT could not be edited from History —
 * the modal only had yes/no toggles. It now carries an editable count with
 * +/- steppers, initialised from the walk and sent to the save path.
 */
describe('EditDoneDetailsModal pee/poop count editing (structural)', () => {
  const source = fs.readFileSync(require.resolve('../EditDoneDetailsModal'), 'utf8').replace(/\r\n/g, '\n');

  it('tracks editable counts, initialised from the walk', () => {
    expect(source).toMatch(/const \[peeCount, setPeeCount\] = useState\(0\)/);
    expect(source).toMatch(/const \[poopCount, setPoopCount\] = useState\(0\)/);
    expect(source).toMatch(/const counts = getWalkEventCounts\(walk\)/);
    expect(source).toMatch(/const hadPee = peeCount > 0/);
  });

  it('offers +/- steppers to adjust each count', () => {
    expect(source).toMatch(/setPeeCount\(\(c\) => Math\.max\(0, c - 1\)\)/);
    expect(source).toMatch(/setPeeCount\(\(c\) => c \+ 1\)/);
    expect(source).toMatch(/setPoopCount\(\(c\) => Math\.max\(0, c - 1\)\)/);
    expect(source).toMatch(/setPoopCount\(\(c\) => c \+ 1\)/);
  });

  it('sends the counts in the save payload', () => {
    expect(source).toMatch(/onSave\(\{[\s\S]*peeCount,[\s\S]*poopCount,/);
    expect(source).toMatch(/peeCount: number; poopCount: number/);
  });
});
