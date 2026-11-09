import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { TimePickerField } from './TimePickerField';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import type { FamilyUser, ScheduleRule } from '../types';
import { friendlyErrorMessage } from '../lib/errorMessages';
import {
  DAY_LONG_LABELS,
  DAY_SHORT_LABELS,
  WEEK_DAYS,
  buildRoutineRows,
  planCellAssignment,
  tintsByUser,
  weeklyLoad,
  type RoutineOp,
} from '../logic/routineGrid';

interface RoutineGridProps {
  rules: ScheduleRule[];
  /** Active family members, in family order (decides each person's tint). */
  users: FamilyUser[];
  dogName: string;
  canEdit: boolean;
  /** Runs rule operations in order (removals before additions). */
  onApply: (ops: RoutineOp[]) => Promise<void>;
  onChangeTime: (oldTime: string, newTime: string) => Promise<void>;
  /** A rotation cell (several people take turns) opens the full rule form. */
  onEditRule: (ruleId: string) => void;
  onAddTime: () => void;
}

type CellSel = { time: string; day: number; userId: string | null };

/**
 * Owner request 2026-11-09: the routine as one weekly table (times × days)
 * instead of a row per rule. Tap a cell to choose who walks (this day, or
 * every day at this time); tap a time to move or remove the whole row.
 */
export function RoutineGrid({ rules, users, dogName, canEdit, onApply, onChangeTime, onEditRule, onAddTime }: RoutineGridProps) {
  const rows = useMemo(() => buildRoutineRows(rules), [rules]);
  const load = useMemo(() => weeklyLoad(rows), [rows]);
  const tints = useMemo(() => tintsByUser(users), [users]);
  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

  const [cell, setCell] = useState<CellSel | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [timeRow, setTimeRow] = useState<string | null>(null);
  const [newTime, setNewTime] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCell = (time: string, day: number) => {
    const c = rows.find((r) => r.time === time)?.cells[day] ?? null;
    if (c?.kind === 'rotation') {
      onEditRule(c.ruleId);
      return;
    }
    const userId = c?.kind === 'person' ? c.userId : null;
    setCell({ time, day, userId });
    setPicked(userId);
    setError(null);
  };

  const run = async (work: () => Promise<void>, close: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      close();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCell = (allDays: boolean) => {
    if (!cell) return;
    const ops = planCellAssignment(rules, cell.time, allDays ? [...WEEK_DAYS] : [cell.day], picked);
    void run(() => onApply(ops), () => setCell(null));
  };

  const openTime = (time: string) => {
    setTimeRow(time);
    setNewTime(time);
    setConfirmDelete(false);
    setError(null);
  };

  const saveTime = () => {
    if (!timeRow) return;
    if (newTime === timeRow) { setTimeRow(null); return; }
    if (rows.some((r) => r.time === newTime)) {
      setError(`כבר יש שורה בשעה ${newTime}. אפשר לשנות בה את המשבצות.`);
      return;
    }
    void run(() => onChangeTime(timeRow, newTime), () => setTimeRow(null));
  };

  const deleteTime = () => {
    if (!timeRow) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    const ops: RoutineOp[] = rules.filter((r) => r.active && r.time === timeRow).map((r) => ({ type: 'delete', ruleId: r.id }));
    void run(() => onApply(ops), () => setTimeRow(null));
  };

  const cellName = (c: (typeof rows)[number]['cells'][number]) =>
    !c ? 'אין טיול' : c.kind === 'rotation' ? 'בתורות' : usersById[c.userId]?.name ?? '?';

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <RtlText style={styles.sectionTitle} accessibilityRole="header">השגרה השבועית</RtlText>
        {canEdit ? (
          <Pressable onPress={onAddTime} accessibilityRole="button" hitSlop={8}>
            <RtlText style={styles.addLink}>+ הוספת שעה</RtlText>
          </Pressable>
        ) : null}
      </View>

      {rows.length === 0 ? (
        <RtlText style={styles.empty}>עדיין לא הוגדרו טיולים קבועים</RtlText>
      ) : (
        <View accessibilityLabel="טבלת השגרה השבועית">
          <View style={styles.row}>
            <View style={styles.timeCol} />
            {WEEK_DAYS.map((d) => (
              <RtlText key={d} style={styles.dayHead}>{DAY_SHORT_LABELS[d]}</RtlText>
            ))}
          </View>
          {rows.map((row) => (
            <View key={row.time} style={styles.row}>
              <Pressable
                style={styles.timeCol}
                onPress={canEdit ? () => openTime(row.time) : undefined}
                disabled={!canEdit}
                accessibilityRole={canEdit ? 'button' : undefined}
                accessibilityLabel={canEdit ? `שינוי או מחיקה של שעת ${row.time}` : row.time}
              >
                <RtlText style={styles.timeText}>{row.time}</RtlText>
              </Pressable>
              {row.cells.map((c, day) => {
                const tint = c?.kind === 'person' ? tints[c.userId] : null;
                const user = c?.kind === 'person' ? usersById[c.userId] : null;
                return (
                  <Pressable
                    key={day}
                    onPress={canEdit ? () => openCell(row.time, day) : undefined}
                    disabled={!canEdit}
                    style={[styles.cell, c ? (tint ? { backgroundColor: tint.bg } : styles.cellRotation) : styles.cellEmpty]}
                    accessibilityRole={canEdit ? 'button' : undefined}
                    accessibilityLabel={`יום ${DAY_LONG_LABELS[day]} ${row.time}: ${cellName(c)}`}
                  >
                    {c?.kind === 'person' ? (
                      <>
                        <RtlText style={styles.cellEmoji}>{user?.avatar ?? '🙂'}</RtlText>
                        <RtlText style={[styles.cellName, tint && { color: tint.fg }]} numberOfLines={1}>{user?.name ?? '?'}</RtlText>
                      </>
                    ) : c?.kind === 'rotation' ? (
                      <>
                        <RtlText style={styles.cellEmoji}>🔄</RtlText>
                        <RtlText style={styles.cellName} numberOfLines={1}>בתורות</RtlText>
                      </>
                    ) : (
                      <RtlText style={styles.cellPlus}>{canEdit ? '+' : '–'}</RtlText>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {rows.length > 0 ? (
        <View style={styles.loadRow}>
          {users.filter((u) => load.byUser[u.id]).map((u) => (
            <View key={u.id} style={[styles.loadChip, { backgroundColor: tints[u.id]?.bg }]}>
              <RtlText style={[styles.loadText, { color: tints[u.id]?.fg }]}>{`${u.avatar} ${u.name} · ${load.byUser[u.id]} בשבוע`}</RtlText>
            </View>
          ))}
          {load.rotation > 0 ? (
            <View style={[styles.loadChip, styles.cellRotation]}><RtlText style={styles.loadText}>{`🔄 בתורות · ${load.rotation}`}</RtlText></View>
          ) : null}
        </View>
      ) : null}
      {canEdit && rows.length > 0 ? (
        <RtlText style={styles.hint}>לוחצים על משבצת כדי לבחור מי מטייל, ועל שעה כדי לשנות או למחוק אותה.</RtlText>
      ) : null}

      {/* Who walks in this cell. */}
      <Modal visible={cell !== null} transparent animationType="slide" onRequestClose={() => setCell(null)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !busy && setCell(null)} accessibilityLabel="סגירה" />
          <View style={styles.sheet}>
            <RtlText style={styles.sheetTitle} accessibilityRole="header">
              {cell ? `יום ${DAY_LONG_LABELS[cell.day]} · ${cell.time}` : ''}
            </RtlText>
            <RtlText style={styles.sheetSub}>{`מי מטייל עם ${dogName}?`}</RtlText>
            <View style={styles.people}>
              {users.map((u) => {
                const on = picked === u.id;
                return (
                  <Pressable
                    key={u.id}
                    onPress={() => setPicked(u.id)}
                    style={[styles.person, { backgroundColor: tints[u.id]?.bg }, on && styles.personOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={u.name}
                  >
                    <RtlText style={styles.personEmoji}>{u.avatar}</RtlText>
                    <RtlText style={[styles.personName, { color: tints[u.id]?.fg }]} numberOfLines={1}>{u.name}</RtlText>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setPicked(null)}
                style={[styles.person, styles.personNone, picked === null && styles.personOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: picked === null }}
                accessibilityLabel="אין טיול"
              >
                <RtlText style={styles.personEmoji}>—</RtlText>
                <RtlText style={styles.personName}>אין טיול</RtlText>
              </Pressable>
            </View>
            {error ? <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</RtlText> : null}
            <View style={styles.actions}>
              <Button label={cell ? `שמירה ליום ${DAY_SHORT_LABELS[cell.day]}` : 'שמירה'} onPress={() => saveCell(false)} loading={busy} disabled={busy} style={styles.flex} />
              <Button label={cell ? `לכל ימי ה-${cell.time}` : 'לכל השבוע'} variant="secondary" onPress={() => saveCell(true)} disabled={busy} style={styles.flex} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Move or remove a whole time row. */}
      <Modal visible={timeRow !== null} transparent animationType="slide" onRequestClose={() => setTimeRow(null)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !busy && setTimeRow(null)} accessibilityLabel="סגירה" />
          <View style={styles.sheet}>
            <RtlText style={styles.sheetTitle} accessibilityRole="header">{`הטיולים של ${timeRow ?? ''}`}</RtlText>
            <RtlText style={styles.sheetSub}>שינוי השעה חל על כל ימי השבוע בשורה הזו.</RtlText>
            <TimePickerField value={newTime} onChange={setNewTime} webLabel="בחירת שעה חדשה לשורה" />
            {error ? <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</RtlText> : null}
            <Button label="שמירת השעה" onPress={saveTime} loading={busy} disabled={busy} style={styles.full} />
            <Button
              label={confirmDelete ? 'לחצו שוב למחיקה מכל השבוע' : 'מחיקת השעה מכל השבוע'}
              variant="secondary"
              accessibilityHint="מוחק את הטיולים בשעה הזו מכל ימי השבוע. טיולים שבוצעו נשארים בהיסטוריה"
              onPress={deleteTime}
              disabled={busy}
              style={styles.full}
            />
            <RtlText style={styles.sheetNote}>טיולים עתידיים שטרם בוצעו יתעדכנו. ההיסטוריה נשארת.</RtlText>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  addLink: { color: colors.primaryDark, fontWeight: '800', fontSize: 15 },
  empty: { color: colors.textSecondary, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginBottom: 4 },
  timeCol: { width: 48, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  timeText: { fontSize: 14, fontWeight: '900', color: colors.textPrimary, writingDirection: 'ltr' },
  dayHead: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '800', color: colors.textSecondary },
  cell: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, paddingHorizontal: 1 },
  cellEmpty: { backgroundColor: colors.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border },
  cellRotation: { backgroundColor: '#F2EEE6' },
  cellEmoji: { fontSize: 16, lineHeight: 19 },
  cellName: { fontSize: 11, lineHeight: 13, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  cellPlus: { fontSize: 18, color: colors.textSecondary },
  loadRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs },
  loadChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  loadText: { fontSize: 12, fontWeight: '800', color: colors.textPrimary },
  hint: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: spacing.lg, gap: spacing.sm, maxWidth: 560, width: '100%', alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  sheetSub: { fontSize: 14, color: colors.textSecondary, textAlign: 'right' },
  sheetNote: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  people: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  person: { width: '31%', borderRadius: 14, paddingVertical: 10, alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  personNone: { backgroundColor: '#F2EEE6' },
  personOn: { borderColor: colors.primaryDark },
  personEmoji: { fontSize: 22, lineHeight: 26 },
  personName: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  actions: { flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
  full: { width: '100%' },
  error: { color: colors.statusOverdue, fontSize: typography.meta.fontSize, textAlign: 'right', fontWeight: '600' },
});
