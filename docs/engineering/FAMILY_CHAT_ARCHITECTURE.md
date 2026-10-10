# Family Chat — Architecture

Status: **Phase 1 implemented** (one private conversation per family).
**Phase 2 (cross-family messaging) is design only** — nothing in this document's
Phase 2 section exists in the database or the UI.

`AGENTS.md` remains the authority for security, migrations and deployment. This
document describes what migration `0108_family_chat.sql` and the chat client do,
and how the model is meant to grow.

## 1. What Phase 1 delivers

- One private group conversation per family, created lazily the first time any
  member opens it.
- Every active family member — admins, regular members, children — can read and
  send. There is no per-member chat permission.
- Real-time delivery through Supabase Realtime (`postgres_changes` on
  `chat_messages`), with a refetch of the latest page whenever the stream
  reconnects or the app returns to the foreground.
- Unread counter per member, shown as a badge on the Chat tab.
- Push notifications for new messages (Expo push and Web Push), excluding the
  sender and honouring notification preferences.
- Family admins can remove a message.

## 2. Data model

| Table | Purpose |
| --- | --- |
| `chat_conversations` | One row per conversation. `kind` is `family`, `direct` or `group`; Phase 1 only ever creates `family`. A partial unique index allows one `family` conversation per family. |
| `chat_conversation_members` | One row per (conversation, profile): read marker (`last_read_at`), `notifications_muted`, `joined_at` / `left_at`. |
| `chat_messages` | `id` (client-generated, the idempotency key), `conversation_id`, `family_id` (the **sender's** family), `sender_user_id`, `body` (1–2000 characters), `created_at`, `deleted_at`, `deleted_by_user_id`. |
| `chat_push_events` | Server-only ledger that makes push delivery at-most-once per message. |

Two deliberate modelling choices make Phase 2 an extension rather than a rewrite:

1. **A conversation is not a family.** Messages belong to a conversation, and
   membership is its own table keyed by profile. A family conversation is simply
   the case where "who is in it" is derived from the family roster.
2. **A message records its sender's family.** In Phase 1 that always equals the
   conversation's family. Across families it is what attribution and per-family
   moderation need.

## 3. Authorization

Clients can only `SELECT`. No chat table has an `INSERT`, `UPDATE` or `DELETE`
policy, and table privileges are reduced to `SELECT`. Every write is a
`SECURITY DEFINER` RPC.

`chat_can_access_conversation(conversation_id)` is the single predicate behind
every `SELECT` policy and every RPC:

- `family` conversation → the caller's real, active profile belongs to the
  conversation's family, and that family is the caller's current, approved
  family. Access follows the roster automatically: a new member can read
  immediately, a removed member loses access immediately.
- `direct` / `group` conversation (Phase 2) → the caller has a membership row
  with `left_at is null`.

Supabase Realtime evaluates the same `SELECT` policy for each subscriber, so a
subscription cannot receive another family's rows even if a client asked for
them.

Identity rules that differ from the rest of the app, on purpose:

- **The sender is never supplied by the client.** `chat_send_message()` takes a
  conversation, an idempotency key and the text. The sender is
  `real_current_profile_id()`.
- **Chat uses the real profile, not the impersonated one.** An admin who is
  impersonating a member still reads chat as themselves, and cannot send or
  moderate until impersonation ends. Nobody can post in someone else's name.
- **The System Admin hidden observer has no access.** Observer mode makes
  ordinary family data readable to a system admin; a family's conversation is
  excluded. This is stricter than other family tables and is intentional.

## 4. RPCs

| RPC | Caller | Behaviour |
| --- | --- | --- |
| `chat_open_family_conversation()` | member | Creates the conversation and the caller's membership row if missing; returns conversation id, read marker, mute state, unread count and whether the caller may moderate. A member's first call marks existing history as read. |
| `chat_send_message(conversation, client_id, body)` | member | Strips control characters, trims, enforces 1–2000 characters and a 20-messages-per-minute limit. Re-sending the same `client_id` returns the original row. |
| `chat_delete_message(message)` | family admin | Erases the text, keeps the row, records who removed it, writes `chat_message_deleted` to the audit log (without the text). |
| `chat_mark_read(conversation, read_at)` | member | Moves the caller's read marker forward only, never past the server's clock. |
| `chat_set_notifications_muted(conversation, muted)` | member | The caller's own preference for this conversation. |
| `chat_push_context(message)` | sender | Returns notification context only to the author of a recent, live message. |
| `chat_push_recipients(message)`, `claim_chat_push_event`, `mark_chat_push_event` | service role | Used only by the `send-chat-push` Edge Function. |

## 5. Client

```
ChatScreen ── useChatStore ── ChatTransport ──┬─ Supabase (RPCs, RLS select, Realtime)
   ▲               ▲                          └─ on-device stand-in (local/demo mode)
   │               │
RootNavigator ── useChatSession (owns the session, connectivity, foreground resync)
```

- `src/logic/chat.ts` — pure rules: validation, text direction, merge, grouping,
  badge formatting.
- `src/lib/chat.ts` — transport. Supabase-direct rather than through the
  offline-first `Repository`/`SyncQueue`, for the same reason
  `src/lib/requests.ts` is: the server alone decides who the sender is and
  whether a message is accepted, so a message is shown as delivered only once
  the server has accepted it.
- `src/store/chatStore.ts` — one live session at a time, keyed by family and
  profile. Starting a session stops the previous one first (releasing its
  Realtime channel and clearing its messages), and every async result is
  discarded if the session changed while it was in flight.
- `src/navigation/useChatSession.ts` — starts and stops the session as family,
  profile or observer state changes, so the unread badge is live on every tab.

**Duplicate prevention.** The device generates a message id once and reuses it
for every retry. The server treats it as an idempotency key, the list is merged
by id, and the push ledger is keyed by it — so an optimistic bubble, the RPC
result, the Realtime echo and a retried send are one message and one
notification.

**Offline.** A message written without a connection is kept as a visibly unsent
bubble and sent when the connection returns. Unsent messages are held in memory
only; closing the app discards them.

## 6. Notifications

The client sends the Edge Function a single value: the message id. The function
authenticates the caller, asks the database (as the caller) whether they wrote
that message, claims the message in `chat_push_events`, reads recipients from
`chat_push_recipients()`, and builds the text from the stored sender name and
message. The sender is excluded in SQL and again in the function.

A member is not notified if the existing per-member notification switch
(`users.reminders_enabled`) is off, or if they muted the conversation from the
chat header. Devices without an active push token or Web Push subscription are
simply not destinations.

## 7. Phase 2 — connections between families (design only)

Goal: two families can connect by invitation and mutual approval, then talk in
private conversations or shared group chats. Not exposed anywhere yet.

### 7.1 Proposed additions

```sql
-- A connection between two families. Unordered pair, one row.
create table family_connections (
  id uuid primary key default gen_random_uuid(),
  family_low_id  uuid not null references families(id) on delete cascade,
  family_high_id uuid not null references families(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined', 'blocked')),
  requested_by_family_id uuid not null references families(id),
  requested_by_user_id   uuid references users(id) on delete set null,
  responded_by_user_id   uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (family_low_id < family_high_id),
  unique (family_low_id, family_high_id)
);

-- Which families take part in a conversation (one row for a family chat).
create table chat_conversation_families (
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  primary key (conversation_id, family_id)
);
```

### 7.2 Flow

1. **Invitation.** An admin of family A invites family B through an RPC that
   takes an opaque invite token (the same hashed-token approach as
   `family_invites`), never a family id typed by a user. Creates a `pending`
   connection.
2. **Mutual approval.** An admin of family B accepts or declines. Only
   `accepted` connections allow conversations. Either side can later block,
   which ends the connection and archives its conversations.
3. **Private conversation** (`kind = 'direct'`): two profiles from two connected
   families. Created by RPC, which inserts both membership rows.
4. **Shared group chat** (`kind = 'group'`): created by an admin of one family
   with selected members of connected families. Each family's admin decides
   which of their own members take part.

### 7.3 What already supports this

- `chat_conversations.kind` and nullable `family_id`.
- `chat_conversation_members` with `family_id`, `joined_at`, `left_at`.
- The explicit-membership branch of `chat_can_access_conversation()`.
- `chat_messages.family_id` (sender's family).
- `chat_push_recipients()` already resolves recipients from membership rows for
  non-family kinds.

### 7.4 What a Phase 2 migration must still do

- Drop `chat_conversations_phase1_family_only` — the constraint that currently
  makes any non-family conversation impossible.
- Add the two tables above, with RLS and RPC-only writes.
- Extend `chat_can_access_conversation()` so an explicit membership also
  requires the member's family to still be an `accepted` participant.
- Moderation: an admin may remove messages sent by **their own family's**
  members (`chat_messages.family_id`), not the other family's.
- A server function that returns display names and avatars of conversation
  participants. A client cannot read another family's `users` rows, and must not
  be given that access; today's screen resolves senders from its own family
  roster and falls back to a neutral label for anyone else.
- Decide safeguards for children before any cross-family UI ships: whether a
  child profile can be added to a cross-family conversation at all, and by whom.
  This is a product and safety decision, not an engineering default.

## 8. Operations

- Verify the migration against a real database with
  `supabase/manual_tests/0108_family_chat_acl.sql` (runs in a transaction and
  rolls back).
- Realtime requires `chat_messages` in the `supabase_realtime` publication; the
  migration adds it when the publication exists.
- Until the migration is applied on an environment, the app shows a calm
  "chat is not enabled here yet" state instead of an error, and the unread
  badge stays hidden.

## 9. Private conversations and image messages (migration 0109)

Section 7 (connections between families) is still design only. What shipped
next is narrower: private one-to-one conversations inside one family, and
image messages in both kinds of conversation. Migration
`0109_private_chat_and_images.sql` is additive — no existing row is rewritten
or deleted, and the family conversation keeps its id and history.

### 9.1 Data model

- `chat_conversations.kind` is `family` or `direct`. A direct conversation
  stores its two participants as `direct_user_low` / `direct_user_high`
  (ordered), and a unique index on `(family_id, low, high)` makes a second
  conversation for the same pair impossible, whichever side opens it.
- `chat_messages` gains `attachment_path`, `attachment_mime`,
  `attachment_width`, `attachment_height`, `attachment_size`. A message has
  text, an image, or both. `attachment_path` is unique.
- `chat_attachment_deletions` queues the file of a removed image message for
  deletion from Storage.

### 9.2 Authorization

- `chat_can_access_conversation` — family: an active member of that family.
  Direct: one of the two participants, still an active member of the family.
  There is deliberately no administrator branch for direct conversations, and
  `chat_actor_profile_id()` is null for a System Admin observer or an
  impersonated session, so neither can read or send.
- `chat_open_direct_conversation(p_other_user_id)` refuses self, removed
  members and members of another family.
- Removal: family messages — family admin (audited). Direct messages — the
  sender only.
- A member who leaves the family loses access to their direct conversations
  at once; the remaining participant sees the thread read-only.

### 9.3 Images

- Private bucket `chat-attachments`, 5 MB, JPEG/PNG/WebP. No public URLs.
- Object name: `<conversation id>/<sender profile id>/<message id>.<ext>`.
  Storage policies call `chat_attachment_uploadable/readable/removable`, so
  upload requires being that sender in that conversation, read requires
  conversation access, and delete is only allowed while no message refers to
  the file (an abandoned upload). There is no UPDATE policy.
- The client resizes to 1600 px on the long edge and re-encodes as JPEG
  before upload; re-encoding drops EXIF, including GPS. Orientation is baked
  into the pixels.
- Send order: upload, then `chat_send_image_message`, which checks that the
  object exists, belongs to the caller and matches the message id. A failed
  or cancelled send removes the uploaded object.
- Display uses signed URLs valid for 10 minutes, cached in memory only.
- Deleting an image message queues its file; the `chat-attachment-cleanup`
  Edge Function removes queued files (invoked after a deletion, and callable
  on a schedule with `CHAT_CLEANUP_CRON_SECRET`).

### 9.4 Push

`chat_push_recipients` returns the other participant only for a direct
conversation. An image is announced as "📷 תמונה" plus any caption; no path
or URL is ever placed in a notification or a log.

### 9.5 Retention and monitoring

Text and images are kept without an expiry. Nothing deletes on a timer.
`select * from chat_storage_usage();` (System Admin) reports message, image
and byte totals plus the pending-cleanup count, for watching storage growth.

### 9.6 Rollout

The client asks `chat_list_conversations()`; if 0109 is not applied it falls
back to the Phase 1 family conversation with private chats and images hidden.
The client is therefore safe to deploy before the migration.
