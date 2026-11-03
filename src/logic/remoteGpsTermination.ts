/**
 * When may a Remote GPS command's end also end the device's GPS session?
 *
 * The command is only the consent/request channel; the walker's device keeps
 * its own v1.1 lease for its own active walk. A device session is therefore
 * ended only for an authorized termination:
 *   - 'stopped'                    the target stopped tracking (stop_remote_gps_tracking)
 *   - failed / consent_revoked     the walker withdrew Remote GPS consent
 *   - failed / family_disabled     a family admin turned Remote GPS off
 *
 * Housekeeping outcomes do NOT end a running session: 'target_inactive' (the
 * admin-side status check fails a command whose acknowledged_at is >30 s old),
 * 'expired', an unknown row, or a lookup error. On real iPhone those ended a
 * live session ~34 s after the first fix while the walk stayed active.
 */
export interface RemoteGpsCommandOutcome {
  status: string;
  failure_reason: string | null;
}

const AUTHORIZED_FAILURE_REASONS = new Set(['consent_revoked', 'family_disabled']);

export function isAuthorizedRemoteGpsTermination(outcome: RemoteGpsCommandOutcome | null | undefined): boolean {
  if (!outcome) return false;
  if (outcome.status === 'stopped') return true;
  return outcome.status === 'failed' && AUTHORIZED_FAILURE_REASONS.has(outcome.failure_reason ?? '');
}

export function describeRemoteGpsOutcome(outcome: RemoteGpsCommandOutcome | null | undefined): string {
  if (!outcome) return 'outcome_unknown';
  return outcome.failure_reason ? `${outcome.status}/${outcome.failure_reason}` : outcome.status;
}
