import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser, Walk, WalkGpsSession } from '../types';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { TimePickerField } from './TimePickerField';
import { pickerDateToTime } from '../logic/timeInput';
import { getWalkEventCounts } from '../logic/walkEventCounts';
import { useGpsStore } from '../store/gpsStore';
import { formatDistanceMeters } from '../logic/gpsDistance';
import { RoutePreview } from './RoutePreview';
import { ConfirmModal } from './ConfirmModal';

interface EditDoneDetailsModalProps {
  visible: boolean;
  walk: Walk | null;
  onSave: (details: { hadPee: boolean; hadPoop: boolean; peeCount: number; poopCount: number; note: string; completedAt?: string; completedByUserId?: string }) => void;
  onClose: () => void;
  /**
   * Final QA round v2 (item D completion): both new, OPT-IN, and
   * backward-compatible — HistoryScreen.tsx's existing usage passes
   * neither, so its behavior (pee/poop/note only, no delete, no
   * completedByUserId in the onSave payload at all) is completely
   * unchanged. Only a caller that passes `users` AND
   * `canReassignCompletedBy` gets the "who actually walked the dog"
   * picker; only a caller that passes `onDelete` gets the delete button.
   */
  users?: FamilyUser[];
  canReassignCompletedBy?: boolean;
  onDelete?: (walkId: string) => void;
  /**
   * PRD §7's required GPS correction flow — attributed to whoever is
   * editing right now. Optional/backward-compatible like the props above:
   * a caller that omits it still gets a distance field whenever this walk
   * has a GPS session (correctedByUserId is simply left unset).
   */
  currentUserId?: string | null;
}

/** Lets you fix up the pee/poop/note (and, for an opted-in caller, who-actually-walked-the-dog / delete / GPS distance) details of a walk after it's already been resolved. */
export function EditDoneDetailsModal({
  visible,
  walk,
  onSave,
  onClose,
  users,
  canReassignCompletedBy,
  onDelete,
  currentUserId,
}: EditDoneDetailsModalProps) {
  const [peeCount, setPeeCount] = useState(0);
  const [poopCount, setPoopCount] = useState(0);
  const hadPee = peeCount > 0;
  const hadPoop = poopCount > 0;
  const [note, setNote] = useState('');
  const [completedAt, setCompletedAt] = useState<Date>(new Date());
  const [completedByUserId, setCompletedByUserId] = useState<string | undefined>(undefined);
  // PRD §7 — GPS is assistive, never the sole source of truth: a family
  // member can confirm/correct the device-computed distance here. Only
  // shown at all once a session with a real reading exists for this walk
  // (undefined distanceMeters means tracking never ran) — never a blocking
  // empty-by-default field, same "optional once GPS data exists" posture
  // Statistics' own distance KPI already established.
  const [gpsDistanceMeters, setGpsDistanceMeters] = useState<number | undefined>(undefined);
  const [distanceInput, setDistanceInput] = useState('');
  const [gpsSession, setGpsSession] = useState<WalkGpsSession | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);

  useEffect(() => {
    if (visible && walk) {
      const counts = getWalkEventCounts(walk);
      setPeeCount(counts.pee);
      setPoopCount(counts.poop);
      setNote(walk.note ?? '');
      setCompletedAt(walk.completedAt ? new Date(walk.completedAt) : new Date(`${walk.date}T${walk.scheduledTime}:00`));
      setCompletedByUserId(walk.completedByUserId ?? walk.responsibleUserId);
      setGpsDistanceMeters(undefined);
      setDistanceInput('');
      void useGpsStore.getState().loadSession(walk.id).then((session) => {
        setGpsSession(session ?? null);
        if (!session || typeof session.distanceMeters !== 'number') return;
        const authoritative = session.correctedDistanceMeters ?? session.distanceMeters;
        setGpsDistanceMeters(session.distanceMeters);
        setDistanceInput(String(Math.round(authoritative)));
      });
    } else if (!visible) {
      setGpsSession(null);
    }
  }, [visible, walk]);

  if (!walk) return null;

  const showCompletedByPicker = canReassignCompletedBy && users && users.length > 0;
  const handleCompletedTimeChange = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    setCompletedAt((prev) => {
      const next = new Date(prev);
      next.setHours(hours, minutes, 0, 0);
      return next;
    });
  };
  const showDistanceField = gpsDistanceMeters != null;
  const displayDate = walk.date.split('-').reverse().join('.');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Round 6C1: same KeyboardAvoidingView pattern already proven in
          RequestTimeChangeModal.tsx — wraps the existing backdrop/sheet/
          ScrollView structure unchanged. */}
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="סגירת עריכת פרטי הטיול" />
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title} accessibilityRole="header">עריכת פרטי הטיול</RtlText>
            <RtlText style={styles.subtitle}>
              {displayDate} · {walk.scheduledTime}
            </RtlText>

            <View style={styles.toggleRow}>
              <View style={styles.needColumn}>
                <Pressable onPress={() => setPeeCount((c) => (c > 0 ? 0 : 1))} accessibilityRole="checkbox" accessibilityState={{ checked: hadPee }} accessibilityLabel="פיפי" style={[styles.toggle, hadPee && styles.toggleActivePee]}>
                  <RtlText style={styles.toggleEmoji}>💧</RtlText>
                </Pressable>
                {hadPee ? (
                  <View style={styles.stepperRow}>
                    <Pressable onPress={() => setPeeCount((c) => Math.max(0, c - 1))} hitSlop={8} accessibilityRole="button" accessibilityLabel="פחות פיפי" style={styles.stepperBtn}><RtlText style={styles.stepperSign}>−</RtlText></Pressable>
                    <RtlText style={styles.stepperCount} accessibilityLabel={`כמות פיפי ${peeCount}`}>{peeCount}</RtlText>
                    <Pressable onPress={() => setPeeCount((c) => c + 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="עוד פיפי" style={styles.stepperBtn}><RtlText style={styles.stepperSign}>+</RtlText></Pressable>
                  </View>
                ) : null}
              </View>
              <View style={styles.needColumn}>
                <Pressable onPress={() => setPoopCount((c) => (c > 0 ? 0 : 1))} accessibilityRole="checkbox" accessibilityState={{ checked: hadPoop }} accessibilityLabel="קקי" style={[styles.toggle, hadPoop && styles.toggleActivePoop]}>
                  <RtlText style={styles.toggleEmoji}>💩</RtlText>
                </Pressable>
                {hadPoop ? (
                  <View style={styles.stepperRow}>
                    <Pressable onPress={() => setPoopCount((c) => Math.max(0, c - 1))} hitSlop={8} accessibilityRole="button" accessibilityLabel="פחות קקי" style={styles.stepperBtn}><RtlText style={styles.stepperSign}>−</RtlText></Pressable>
                    <RtlText style={styles.stepperCount} accessibilityLabel={`כמות קקי ${poopCount}`}>{poopCount}</RtlText>
                    <Pressable onPress={() => setPoopCount((c) => c + 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="עוד קקי" style={styles.stepperBtn}><RtlText style={styles.stepperSign}>+</RtlText></Pressable>
                  </View>
                ) : null}
              </View>
            </View>

            <RtlText style={styles.label}>שעת ביצוע</RtlText>
            <TimePickerField
              value={pickerDateToTime(completedAt)}
              onChange={handleCompletedTimeChange}
              webLabel="בחירת שעת ביצוע הטיול"
            />

            {showCompletedByPicker ? (
              <>
                {/*
                  Final QA round v2: corrects WHO actually walked the dog
                  (completedByUserId), deliberately NOT the walk's
                  responsibleUserId (rotation assignment) — see
                  WalkCompletionDetails' own doc comment in
                  src/logic/walkActions.ts for why reassigning
                  responsibleUserId stays out of this modal entirely.
                */}
                <RtlText style={styles.label}>מי ביצע את הטיול</RtlText>
                <View style={styles.memberRow}>
                  {users!.map((u) => (
                    <Pressable
                      key={u.id}
                      onPress={() => setCompletedByUserId(u.id)}
                      style={[styles.memberChip, completedByUserId === u.id && styles.memberChipActive]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: completedByUserId === u.id }}
                      accessibilityLabel={u.name}
                    >
                      <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={32} />
                      <RtlText style={styles.memberChipName} numberOfLines={1}>
                        {u.name}
                      </RtlText>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {showDistanceField ? (
              <>
                <RtlText style={styles.label}>מרחק (מטרים)</RtlText>
                <TextInput
                  value={distanceInput}
                  onChangeText={setDistanceInput}
                  keyboardType="number-pad"
                  style={styles.noteInput}
                  textAlign="right"
                  accessibilityLabel="מרחק בטיול, במטרים"
                />
                <RtlText style={styles.gpsHint}>
                  מדידת GPS מקורית: {formatDistanceMeters(gpsDistanceMeters!)}
                </RtlText>
              </>
            ) : null}

            {gpsSession?.routePoints && gpsSession.routePoints.length > 1 ? (
              <>
                <RtlText style={styles.label}>מסלול הטיול</RtlText>
                <RoutePreview session={gpsSession} large />
              </>
            ) : null}

            <RtlText style={styles.label}>הערה</RtlText>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="הערה חופשית"
              placeholderTextColor={colors.textSecondary}
              style={styles.noteInput}
              multiline
              textAlign="right"
              accessibilityLabel="הערה"
            />

            <View style={styles.actions}>
              <Button
                label="שמירה"
                onPress={() => {
                  onSave({
                    hadPee,
                    hadPoop,
                    peeCount,
                    poopCount,
                    note: note.trim(),
                    // Only included when this caller opted into the
                    // picker — History's existing call site (no `users`/
                    // `canReassignCompletedBy` passed) never sends this
                    // field, so its behavior is byte-identical to before.
                    completedAt: completedAt.toISOString(),
                    ...(showCompletedByPicker ? { completedByUserId } : {}),
                  });
                  // GPS correction is a separate, independent write (its
                  // own store/table, not part of `walks`) — best-effort,
                  // never blocking or failing the primary save above.
                  if (showDistanceField) {
                    const parsed = Number(distanceInput);
                    if (Number.isFinite(parsed) && parsed >= 0) {
                      void useGpsStore.getState().correctDistance(walk.id, parsed, currentUserId);
                    }
                  }
                }}
                style={styles.flex}
              />
              <Button label="ביטול" onPress={onClose} variant="secondary" style={styles.flex} />
            </View>

            {onDelete ? (
              <Button
                label="🗑️ מחיקת הטיול"
                variant="danger"
                accessibilityHint="יוצג אישור לפני מחיקה לצמיתות של הטיול"
                onPress={() => setDeleteConfirmVisible(true)}
                style={styles.deleteButton}
              />
            ) : null}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
      <ConfirmModal
        visible={deleteConfirmVisible}
        title="למחוק את הטיול?"
        message="הפעולה תסיר את הטיול הזה לצמיתות. אי אפשר לבטל."
        confirmLabel="מחק"
        onConfirm={() => {
          setDeleteConfirmVisible(false);
          onDelete?.(walk.id);
        }}
        onCancel={() => setDeleteConfirmVisible(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  flexFull: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 18, maxHeight: '86%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: typography.meta.fontSize, color: colors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 12 },
  label: { fontSize: typography.meta.fontSize, fontWeight: '700', color: colors.textSecondary, marginTop: 14, marginBottom: 6, textAlign: 'right' },
  needColumn: { alignItems: 'center', gap: spacing.xs },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  stepperSign: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, lineHeight: 20 },
  stepperCount: { minWidth: 20, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  toggle: {
    flex: 1,
    minHeight: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  toggleActivePee: { backgroundColor: colors.statusCurrentBg, borderColor: colors.primary },
  toggleActivePoop: { backgroundColor: colors.statusSkippedBg, borderColor: colors.statusSkipped },
  toggleEmoji: { fontSize: 24 },
  toggleLabel: { fontSize: typography.cardTitle.fontSize, fontWeight: typography.cardTitle.fontWeight, color: colors.textSecondary },
  toggleLabelActive: { color: colors.textPrimary },
  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  memberChipActive: { borderColor: colors.primary, backgroundColor: colors.statusCurrentBg },
  memberChipName: { fontSize: typography.meta.fontSize, fontWeight: '700', color: colors.textPrimary, maxWidth: 90 },
  gpsHint: { fontSize: 12, color: colors.textSecondary, textAlign: 'right', marginTop: 4 },
  noteInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: 14,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: 18 },
  flex: { flex: 1 },
  deleteButton: { marginTop: 10, opacity: 0.88 },
});
