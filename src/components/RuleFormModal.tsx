import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser, ScheduleRule } from '../types';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { Avatar } from '../components/Avatar';
import { Button } from './Button';
import { TimePickerField } from './TimePickerField';
import { is24HourTime } from '../logic/timeInput';
// TEMPORARY DIAGNOSTIC INSTRUMENTATION — see perfTrace.ts's own doc
// comment. Remove this import and every perfMark/perfReset/perfReport
// call in this file once the real ~10s Schedule-save bottleneck is
// confirmed fixed by an actual real-device measurement.
import { perfMark, perfReport, perfReset } from '../lib/perfTrace';

const DAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
// Round 6F: full spoken day names for the day chips' accessibilityLabel —
// the visible DAY_LABELS above (single-letter initials) stay unchanged;
// this is additive, assistive-tech-only information, same index order.
const DAY_ACCESSIBILITY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export interface RuleFormResult {
  time: string;
  label: string;
  daysOfWeek: number[];
  rotationUserIds: string[];
}

interface RuleFormModalProps {
  visible: boolean;
  editingRule: ScheduleRule | null;
  users: FamilyUser[];
  existingRules?: ScheduleRule[];
  dogId?: string;
  /**
   * Real-device QA fix (double-tap "שמירה" false-failure bug) — this is
   * now awaited (see `submit` below), so a caller's async add/update work
   * actually gates this modal's own saving state instead of firing and
   * forgetting it. Every existing caller (ScheduleScreen.tsx) already
   * passes an async function here; this is a type correction, not a
   * behavior change for them.
   */
  onSave: (result: RuleFormResult) => Promise<void>;
  onClose: () => void;
}

/** Add or edit one of the family's daily walk time slots: time, optional label, active days, and the single family member responsible for it. */
export function RuleFormModal({ visible, editingRule, users, existingRules = [], dogId, onSave, onClose }: RuleFormModalProps) {
  const [time, setTime] = useState('08:00');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [rotation, setRotation] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Real-device QA fix: the "double-tap שמירה" bug — tapping Save twice
  // before the first addRule() resolved fired TWO concurrent, independent
  // adds for the identical time slot (no busy/disabled state stopped the
  // second tap), so the first succeeded and the second hit
  // schedule_rules_active_identity_uidx (migration 0099) and surfaced a
  // misleading "couldn't add" error for a save that had already worked.
  // `saving` makes one tap enough: the Save button disables (and shows a
  // spinner, via Button's own `loading` prop) for the whole duration of
  // the caller's async onSave(), so a second tap in that window is simply
  // impossible from this modal.
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setTime(editingRule?.time ?? '08:00');
      setLabel(editingRule?.label ?? '');
      setDays(editingRule?.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]);
      // Real-device QA fix — single assignee per scheduled walk/rule (see
      // selectResponsibleUser's own doc comment below). An existing rule
      // from BEFORE this fix may still carry more than one id in
      // rotationUserIds (the demo seed's default rules do, by design, for
      // the now-retired multi-member "family rotation" authoring flow) —
      // this shows exactly ITS CURRENT assignee by taking only the first
      // id, never all of them. Saving this rule again (even unchanged)
      // collapses it to that one member going forward; the underlying
      // column is untouched otherwise.
      // For a newly created rule in a one-member family, select that sole\n      // member automatically. Never override the assignee of an existing rule.\n      setRotation(editingRule ? (editingRule.rotationUserIds?.slice(0, 1) ?? []) : (users.length === 1 ? [users[0].id] : []));
      setError(null);
      setSaving(false);
    }
  }, [visible, editingRule, users]);

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  /**
   * Real-device QA fix — a scheduled walk/rule has exactly ONE responsible
   * family member, never more. The previous toggleRotationUser() ADDED to
   * `rotation` (a real, deliberate "family rotation" feature —
   * rotation.ts's resolveResponsibleForDate() cycles through MULTIPLE ids
   * across different days when more than one is present), which let this
   * screen select several members for one time slot — not the intended
   * behavior going forward. This always REPLACES the selection with
   * exactly the tapped member; it is a plain single-select/radio action,
   * never a toggle, so there is never a way to end up with zero OR more
   * than one selected via this control (tapping the already-selected
   * member is a harmless no-op, not a deselect — a rule must always have
   * someone responsible).
   *
   * Deliberately UI-only: `rotationUserIds` on ScheduleRule/the
   * schedule_rules column is untouched (still a string array) — this
   * never widens or narrows what the DATA MODEL can store, only what this
   * screen ever WRITES into it (always a single-element array). Multi-
   * member rotation logic in rotation.ts is untouched and still correctly
   * resolves a single-element array (resolveResponsibleForDate() already
   * special-cases length 1 — no rotation math needed).
   */
  const selectResponsibleUser = (id: string) => setRotation([id]);

  const submit = async () => {
    if (saving) return; // re-entrancy guard — belt-and-suspenders alongside the disabled Button below.
    if (!is24HourTime(time)) return setError('שעה לא תקינה — פורמט HH:mm, למשל 08:00');
    if (days.length === 0) return setError('יש לבחור לפחות יום אחד');
    if (rotation.length === 0) return setError('יש לבחור אחראי/ת לטיול');
    // A rule can share a clock time only when its days do not overlap, or it belongs to another dog.
    const conflicting = existingRules.some((rule) => rule.active && rule.dogId === dogId && rule.id !== editingRule?.id && rule.time === time && rule.daysOfWeek.some((day) => days.includes(day)));
    if (conflicting) return setError(`כבר קיים טיול קבוע בשעה ${time} באחד הימים שבחרת. בחרו שעה אחרת או ערכו את הטיול הקיים.`);
    // TEMPORARY DIAGNOSTIC INSTRUMENTATION — see perfTrace.ts's own doc
    // comment. perfReset() here starts a fresh trace for exactly this one
    // save attempt.
    perfReset();
    perfMark('T0 submit entered (validated)');
    setError(null);
    setSaving(true);
    try {
      perfMark('T1 onSave called');
      await onSave({ time, label: label.trim(), daysOfWeek: days, rotationUserIds: rotation });
      perfMark('T2 onSave resolved');
    } finally {
      setSaving(false);
    }
    // TEMPORARY: surfaces the full timestamped breakdown directly on the
    // device via a plain Alert — readable without Safari's remote
    // debugger. Remove this call (and the import above) once the real
    // bottleneck is found and fixed.
    Alert.alert('⏱ Diagnostics (temp)', perfReport());
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Round 6C1: same KeyboardAvoidingView pattern already proven in
          RequestTimeChangeModal.tsx — wraps the existing backdrop/sheet/
          ScrollView structure unchanged. */}
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.backdrop}>
          {/* Keep the dismiss target as a sibling behind the sheet instead of
              wrapping the form. This prevents TextInput/keyboard events from
              bubbling into the backdrop and closing the walk-properties
              editor while a label/note is being typed. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={editingRule ? 'סגירת עריכת טיול קבוע' : 'סגירת הגדרת טיול קבוע'}
          />
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title} accessibilityRole="header">{editingRule ? 'עריכת טיול קבוע' : 'הגדרת טיול קבוע'}</RtlText>

            <RtlText style={styles.label}>שעת הטיול</RtlText>
            <TimePickerField value={time} onChange={setTime} webLabel="בחירת שעת טיול" />

            <RtlText style={styles.label}>שם הטיול (לא חובה)</RtlText>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="למשל: טיול בוקר או הערה"
              style={styles.input}
              textAlign="right"
              accessibilityLabel="שם הטיול (לא חובה)"
            />

            <RtlText style={styles.label}>ימים</RtlText>
            <View style={styles.dayRow}>
              {DAY_LABELS.map((l, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => toggleDay(idx)}
                  style={[styles.dayChip, days.includes(idx) && styles.dayChipActive]}
                  // Round 6F: selection here is currently conveyed only via
                  // background color (dayChipActive) — accessibilityState
                  // exposes that same selected/unselected state to assistive
                  // tech, and the full day name replaces the ambiguous
                  // single-letter visible label for the accessible name only
                  // (the visible letter itself is unchanged).
                  accessibilityRole="button"
                  accessibilityState={{ selected: days.includes(idx) }}
                  accessibilityLabel={DAY_ACCESSIBILITY_NAMES[idx]}
                >
                  <RtlText style={[styles.dayChipText, days.includes(idx) && styles.dayChipTextActive]}>{l}</RtlText>
                </Pressable>
              ))}
            </View>

            <RtlText style={styles.label}>אחראי/ת לטיול</RtlText>
            <View style={styles.rotationRow}>
              {users.map((u) => {
                const isSelected = rotation[0] === u.id;
                return (
                  <Pressable
                    key={u.id}
                    onPress={() => selectResponsibleUser(u.id)}
                    style={[styles.rotationChip, isSelected && styles.rotationChipActive]}
                    // Single-select (radio) semantics: at most one member is
                    // ever selected, so a screen reader needs only
                    // selected/unselected — no position/order to convey
                    // anymore (no badge is rendered either, below).
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected, checked: isSelected }}
                    accessibilityLabel={u.name}
                  >
                    <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={40} />
                    <RtlText style={[styles.rotationName, isSelected && styles.rotationNameActive]} numberOfLines={1}>
                      {u.name}
                    </RtlText>
                  </Pressable>
                );
              })}
            </View>

            {error ? (
              <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </RtlText>
            ) : null}

            <View style={styles.actions}>
              <Button label="שמירה" onPress={submit} loading={saving} style={styles.flex} />
              <Button label="ביטול" onPress={onClose} variant="secondary" style={styles.flex} />
            </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flexFull: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  label: { fontSize: typography.meta.fontSize, fontWeight: '700', color: colors.textSecondary, marginTop: 14, marginBottom: spacing.sm, textAlign: 'right' },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: 14,
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
  },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayChip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 2, borderColor: 'transparent', backgroundColor: colors.surfaceMuted, alignItems: 'center' },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primaryDark },
  dayChipText: { fontWeight: '700', color: colors.textSecondary },
  dayChipTextActive: { color: colors.textInverse },
  rotationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  rotationChip: { alignItems: 'center', minWidth: 64, padding: 6, borderRadius: 14 },
  // Real-device QA fix — single-select now needs its own visible
  // selected/unselected contrast (the removed numeric badge used to be
  // the only such indicator, which no longer makes sense once at most
  // one member can ever be selected).
  rotationChipActive: { backgroundColor: colors.surfaceMuted },
  rotationName: { fontSize: 12, color: colors.textPrimary, marginTop: spacing.xs },
  rotationNameActive: { fontWeight: '700', color: colors.primaryDark },
  error: { fontSize: typography.meta.fontSize, color: colors.statusOverdue, fontWeight: '600', marginTop: 10, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  flex: { flex: 1 },
});
