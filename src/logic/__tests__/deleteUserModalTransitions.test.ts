import { nextDeleteReplacementSelection } from '../deleteUserModalTransitions';

describe('nextDeleteReplacementSelection', () => {
  it('does nothing while the modal is closed', () => {
    expect(nextDeleteReplacementSelection(false, false, null, ['a', 'b'])).toBeUndefined();
    expect(nextDeleteReplacementSelection(false, true, 'a', ['a', 'b'])).toBeUndefined();
  });

  it('defaults to the first candidate on an actual open transition (false -> true)', () => {
    expect(nextDeleteReplacementSelection(true, false, null, ['a', 'b'])).toBe('a');
  });

  it('defaults to null on open when there are no candidates', () => {
    expect(nextDeleteReplacementSelection(true, false, null, [])).toBeNull();
  });

  it('regression: an unrelated re-render (new array, same ids, already open) must NOT clobber a deliberate selection', () => {
    // Modal is already open (wasVisible=true) and the admin picked 'b', not
    // the default 'a'. FamilyScreen re-rendering for an unrelated reason
    // (e.g. its presence-refresh interval) passes a brand-new `otherUsers`
    // array reference with the identical ids — this must be a no-op.
    expect(nextDeleteReplacementSelection(true, true, 'b', ['a', 'b', 'c'])).toBeUndefined();
  });

  it('falls back to the first candidate if the selected replacement is no longer present (by id, not reference)', () => {
    expect(nextDeleteReplacementSelection(true, true, 'b', ['a', 'c'])).toBe('a');
  });

  it('falls back to null if the selected replacement is gone and no candidates remain', () => {
    expect(nextDeleteReplacementSelection(true, true, 'b', [])).toBeNull();
  });

  it('stays a no-op across repeated unrelated re-renders as long as the selection remains valid', () => {
    expect(nextDeleteReplacementSelection(true, true, 'a', ['a', 'b'])).toBeUndefined();
    expect(nextDeleteReplacementSelection(true, true, 'a', ['a', 'b', 'c'])).toBeUndefined();
  });
});
