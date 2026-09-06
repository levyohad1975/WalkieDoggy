import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { OfflineFirstRepository } from './offlineFirstRepository';
import { SupabaseRepository } from './supabaseRepository';
import type { Repository } from './repository';

/**
 * Single app-wide repository instance. Screens/stores import `repository`
 * from here — never construct their own.
 */
export const repository: Repository = new OfflineFirstRepository(
  isSupabaseConfigured && supabase ? new SupabaseRepository(supabase) : null
);

export type { Repository } from './repository';
export { setSyncQueueActorGetter } from './syncQueue';
