import fs from 'fs';

/**
 * Request-notifications repair, item B — the Home Dashboard pending-request
 * card. Source-scan convention: this repo has no render-test harness for
 * components (see DogSelectorRow.structure.test.ts's own doc comment). The
 * underlying authorization/selection logic (which items a viewer may act
 * on) is covered separately and thoroughly in
 * logic/__tests__/requestLifecycle.test.ts's selectActionablePendingRequestsForViewer
 * suite — these tests only cover this component's own rendering contract.
 */
describe('PendingRequestsCard (structural)', () => {
  const source = fs.readFileSync(require.resolve('../PendingRequestsCard'), 'utf8').replace(/\r\n/g, '\n');

  it('renders nothing at all when there are no actionable items', () => {
    expect(source).toMatch(/if \(items\.length === 0\) return null;/);
  });

  it('caps inline detailed cards at MAX_INLINE and collapses the rest into one overflow row', () => {
    expect(source).toMatch(/const MAX_INLINE = 2;/);
    expect(source).toMatch(/const inline = items\.slice\(0, MAX_INLINE\);/);
    expect(source).toMatch(/const overflowCount = items\.length - inline\.length;/);
    expect(source).toMatch(/overflowCount > 0 \?/);
  });

  it('every inline swap card wires approve/decline to the caller-supplied swap actions, never a second/parallel action path', () => {
    expect(source).toMatch(/onPress=\{\(\) => onApproveSwap\(item\.id\)\}/);
    expect(source).toMatch(/onPress=\{\(\) => onRejectSwap\(item\.id\)\}/);
  });

  it('every inline time-change card wires approve/decline to the caller-supplied time-change actions', () => {
    expect(source).toMatch(/onPress=\{\(\) => onApproveTimeChange\(item\.id\)\}/);
    expect(source).toMatch(/onPress=\{\(\) => onRejectTimeChange\(item\.id\)\}/);
  });

  it('the overflow row opens the full inbox rather than acting on anything itself', () => {
    expect(source).toMatch(/onPress=\{onOpenInbox\}/);
  });

  it('shows who requested what for a swap: requester name and both walks\' times', () => {
    expect(source).toMatch(/מבקש\/ת להחליף את הטיול שלך/);
    expect(source).toMatch(/requesterTime/);
    expect(source).toMatch(/viewerTime/);
  });

  it('shows who requested what for a time-change: requester name, existing time, and requested time', () => {
    expect(source).toMatch(/משעה \{item\.expectedTime\} לשעה \{item\.proposedTime\}/);
  });

  it('falls back to a gender-neutral placeholder name rather than a blank/undefined string when a user cannot be resolved', () => {
    expect(source).toMatch(/usersById\[userId\]\?\.name \?\? 'בן\/בת המשפחה'/);
  });
});
