/**
 * Generates a UUID v4 compatible identifier for client-created records.
 * Supabase/Postgres UUID columns require this format.
 *
 * The prefix argument is kept for backward compatibility with existing
 * callers, but is intentionally not included in the returned UUID.
 */
export function generateId(_prefix = ''): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
