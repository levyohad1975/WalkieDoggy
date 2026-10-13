# RTL / photos / request-status round

- Bottom tab bar is custom-rendered in a fixed physical LTR row: Settings at the left edge, Home at the right edge. Dynamic Type cannot mirror route placement.
- Settings no longer duplicates the Family tab with a “המשפחה שלי” card.
- Main/section/card headings in Home, History, Statistics, Settings, Family and Schedule are explicitly stretched/right-aligned where applicable.
- Home next-walk heading row has deterministic RTL visual placement.
- Photo upload no longer depends on ImagePicker base64. It reads the selected SDK 57 asset URI as binary and uploads that to Supabase Storage; permission denial now explains what is needed.
- Dog photo save is awaited so upload + DB persistence is one visible operation.
- Resolved time-change status (✓ approved / ✕ rejected) is shown for 24h only to the original requester; all users still see the authoritative updated walk time.
- Approved request status uses the app's green completed/status color on Home and Schedule cards.
- Added regression tests for fixed physical tab order and requester-only resolved time-change feedback.
