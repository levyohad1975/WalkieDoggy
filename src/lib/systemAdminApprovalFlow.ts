export class SystemAdminApprovalRefreshError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('family approval was saved but refreshed data could not be loaded');
    this.name = 'SystemAdminApprovalRefreshError';
    this.cause = cause;
  }
}

type ApprovalFlowDependencies<T> = {
  commit: () => Promise<void>;
  onCommitted: () => void;
  refresh: () => Promise<T>;
};

/**
 * Keeps the irreversible boundary explicit for UI state: once commit()
 * succeeds, onCommitted() must run before any fallible refresh. This lets the
 * screen remove stale approve/reject actions even if the follow-up read fails.
 */
export async function commitFamilyApprovalAndRefresh<T>(
  dependencies: ApprovalFlowDependencies<T>
): Promise<T> {
  await dependencies.commit();
  dependencies.onCommitted();
  try {
    return await dependencies.refresh();
  } catch (cause) {
    throw new SystemAdminApprovalRefreshError(cause);
  }
}
