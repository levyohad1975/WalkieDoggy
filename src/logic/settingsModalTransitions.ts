/**
 * Settings nested-modal lifecycle — pure decision logic.
 *
 * Background (final QA round, extended in a later patch to cover the
 * real-impersonation picker too): SettingsScreen's "⚙️ ניהול" Management
 * sheet used to open AdminActivityModal / AdminAuditLogModal / the
 * real-impersonation UserPickerModal (each its own top-level `<Modal>`)
 * WHILE the Management `<Modal>` itself stayed `visible={true}` — two RN `Modal`s (each backed by its own UIViewController
 * on iOS) presented simultaneously, one stacked on the other without the
 * first ever being asked to dismiss. Real-device QA found the child modal
 * could fail to visibly present in that state.
 *
 * The fix: close Management FIRST, remember which child modal was
 * requested, and only actually open that child once Management's own
 * dismissal has genuinely completed — never a blind `setTimeout` guess.
 * This file is the pure "what should happen" decision, factored out of
 * SettingsScreen.tsx so it's reviewable/testable as plain TypeScript; the
 * component only supplies the platform-appropriate completion signal:
 *   - iOS: `Modal`'s own `onDismiss` prop (iOS-only, fires once the native
 *     dismissal animation has actually finished) is the genuine completion
 *     callback — not a guess.
 *   - Android (and any other platform): `Modal` has no `onDismiss`, so the
 *     component instead reacts to `managementVisible` having become
 *     `false` (a `useEffect` keyed on that flag) — Android's Modal/Dialog
 *     teardown is synchronous enough from JS's perspective that this
 *     ordinary state-driven transition (not a timer) is the correct signal
 *     there.
 */

export type SettingsChildModal = 'activity' | 'auditLog' | 'impersonation';

export interface PendingChildModalState {
  managementVisible: boolean;
  pendingChildModal: SettingsChildModal | null;
}

export type ManagementDismissSignal =
  /** iOS only: Modal's own onDismiss fired — the native dismissal genuinely finished. */
  | 'ios-native-dismiss'
  /** Non-iOS: managementVisible just became false (no native completion callback exists to wait for). */
  | 'visibility-effect';

/**
 * Given the current pending-child-modal state and which platform-specific
 * completion signal just fired, decide which child modal (if any) should
 * now actually be opened. Returns null when there is nothing to do — e.g.
 * no child was requested, or (for the visibility-effect signal) Management
 * hasn't actually finished closing yet.
 */
export function decideChildModalToOpen(
  state: PendingChildModalState,
  signal: ManagementDismissSignal
): SettingsChildModal | null {
  if (!state.pendingChildModal) return null;
  if (signal === 'ios-native-dismiss') return state.pendingChildModal;
  // 'visibility-effect': only fire once Management has actually closed.
  return state.managementVisible ? null : state.pendingChildModal;
}
