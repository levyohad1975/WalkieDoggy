import { supabase } from '../lib/supabase';

export interface WalkLifecycleOpenEvent {
  walkId: string;
  notificationIds: string[];
}

/** Validates push data and records a recipient's actual app-open acknowledgment. */
export function walkLifecycleOpenFromNotificationData(data: unknown): WalkLifecycleOpenEvent | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as { type?: unknown; walkId?: unknown; notificationIds?: unknown };
  if (value.type !== 'walk_lifecycle' || typeof value.walkId !== 'string' || !Array.isArray(value.notificationIds)) return null;
  const notificationIds = value.notificationIds.filter((id): id is string =>
    typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
  );
  if (!notificationIds.length) return null;
  return { walkId: value.walkId, notificationIds: [...new Set(notificationIds)] };
}

export async function acknowledgeWalkLifecycleOpen(event: WalkLifecycleOpenEvent): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('acknowledge_walk_lifecycle_notifications_v11', {
    p_notification_ids: event.notificationIds,
  });
  if (error) console.warn('[walkLifecycle] app-open acknowledgment failed', { walkId: event.walkId, error });
}
