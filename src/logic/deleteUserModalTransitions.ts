/**
 * DeleteUserModal replacement-picker persistence — pure decision logic.
 *
 * Background: FamilyScreen recomputes its `otherUsers` prop inline
 * (`users.filter(...)`) on every render, including unrelated ones — its own
 * 2-minute presence-refresh interval and AppState foreground listener both
 * call `setActivity(...)`, which re-renders FamilyScreen while this modal is
 * still open. DeleteUserModal used to reset its `replacement` selection
 * whenever that `otherUsers` array *reference* changed, silently discarding
 * an admin's deliberate in-progress pick (who takes over the departing
 * member's future rotation/walks) mid-decision — a real data-integrity risk
 * for an irreversible, unconfirmed-undo action.
 *
 * The fix: only reset on an actual open transition (`visible` going
 * false -> true), or if the currently-selected replacement is no longer
 * present among the candidates by *content* (id membership), never by array
 * identity. This file is the pure "what should happen" decision, factored
 * out of DeleteUserModal.tsx so it's reviewable/testable as plain
 * TypeScript, following the same pattern as settingsModalTransitions.ts.
 */

/**
 * Given the modal's visibility transition, the currently-selected
 * replacement id, and the current candidate ids, decide what the
 * replacement selection should become. Returns `undefined` when nothing
 * should change (an ordinary re-render with no actual open transition and a
 * still-valid selection).
 */
export function nextDeleteReplacementSelection(
  visible: boolean,
  wasVisible: boolean,
  replacement: string | null,
  otherUserIds: readonly string[]
): string | null | undefined {
  if (!visible) return undefined;
  const justOpened = !wasVisible;
  const replacementStillValid = replacement !== null && otherUserIds.includes(replacement);
  if (justOpened || !replacementStillValid) {
    return otherUserIds[0] ?? null;
  }
  return undefined;
}
