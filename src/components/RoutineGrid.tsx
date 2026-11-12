import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { TimePickerField } from './TimePickerField';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import type { FamilyUser, ScheduleRule } from '../types';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { previewRotation } from '../logic/rotation';
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
import { openRequestCellKeys, routineSlotLabel, type RoutineChangeRequest } from '../logic/routineRequests';
import type { NewRoutineRequest } from '../lib/routineRequests';

/** A request as the grid builds it; the screen adds the dog. */
export type RoutineRequestDraft = Omit<NewRoutineRequest, 'dogId'>;

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
  /** The signed-in member; with onRequest, a non-admin can ask for changes. */
  currentUserId?: string;
  /** Open requests, to mark the cells they touch. */
  requests?: RoutineChangeRequest[];
  /** Ask for a permanent change (goes to the other member, then the admin). */
  onRequest?: (draft: RoutineRequestDraft) => Promise<void>;
  /** One-off shortcut: the existing request for the next walk in this cell. */
  onOneOff?: (day: number, time: string, mode: 'swap' | 'time') => void;
  /**
   * Ask to take only the next walk in another member's cell (owner request
   * 2026-11-12). Resolves to a short label of that walk's date ("19.11").
   */
  onTakeOnce?: (day: number, time: string, ownerId: string) => Promise<string>;
  /** Admin: move one day's walk to another time (that day only). */
  onMoveCell?: (day: number, fromTime: string, toTime: string, userId: string) => Promise<void>;
}

type RequestSel = { time: string; day: number; ownerId: string };
type RequestStep = 'menu' | 'swapPick' | 'givePick' | 'time';

type CellSel = { time: string; day: number; userId: string | null };

/**
 * Owner request 2026-11-09: the routine as one weekly table (times × days)
 * instead of a row per rule. Tap a cell to choose who walks (this day, or
 * every day at this time); tap a time to move or remove the whole row.
 */
export function RoutineGrid({ rules, users, dogName, canEdit, onApply, onChangeTime, onEditRule, onAddTime, currentUserId, requests = [], onRequest, onOneOff, onTakeOnce, onMoveCell }: RoutineGridProps) {
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
  const [req, setReq] = useState<RequestSel | null>(null);
  const [reqStep, setReqStep] = useState<RequestStep>('menu');
  const [reqTime, setReqTime] = useState('');
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const [moveTime, setMoveTime] = useState<string | null>(null); // admin: "this day only" time change

  // Family members (not the admin) tap a person's cell to ask for a change.
  const canRequest = !canEdit && Boolean(onRequest && currentUserId);
  const requestCells = useMemo(() => openRequestCellKeys(requests), [requests]);
  const personCells = useMemo(
    () => WEEK_DAYS.flatMap((day) => rows.flatMap((row) => {
      const c = row.cells[day];
      return c?.kind === 'person' ? [{ day: day as number, time: row.time, userId: c.userId }] : [];
    })),
    [rows],
  );

  const openRequest = (time: string, day: number) => {
    const c = rows.find((r) => r.time === time)?.cells[day] ?? null;
    if (c?.kind !== 'person') return;
    setReq({ time, day, ownerId: c.userId });
    setReqStep('menu');
    setReqTime(time);
    setError(null);
  };

  const sendRequest = (draft: RoutineRequestDraft, toName: string | null) => {
    if (!onRequest) return;
    void run(() => onRequest(draft), () => {
      setReq(null);
      setSentNotice(toName ? `הבקשה נשלחה ל${toName}, ואחריו/ה לאישור מנהל המשפחה.` : 'הבקשה נשלחה לאישור מנהל המשפחה.');
    });
  };

  const openCell = (time: string, day: number) => {
    const c = rows.find((r) => r.time === time)?.cells[day] ?? null;
    if (c?.kind === 'rotation') {
      onEditRule(c.ruleId);
      return;
    }
    const userId = c?.kind === 'person' ? c.userId : null;
    setCell({ time, day, userId });
    setPicked(userId);
    setMoveTime(null);
    setError(null);
  };

  const run = async (work: () => Promise<void>, close: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      close();
    } catch (e) {
      // A message the screen already wrote in Hebrew is shown as is.
      setError(e instanceof Error && /[\u0590-\u05FF]/.test(e.message) ? e.message : friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCell = (allDays: boolean) => {
    if (!cell) return;
    const ops = planCellAssignment(rules, cell.time, allDays ? [...WEEK_DAYS] : [cell.day], picked);
    void run(() => onApply(ops), () => setCell(null));
  };

  // Owner request 2026-11-10: change the time of ONE day without touching
  // the rest of the row ("איך משנים שעה ליום ספציפי?").
  const saveMove = () => {
    if (!cell || !picked || !moveTime || !onMoveCell) return;
    if (moveTime === cell.time) { setError('בחרו שעה אחרת מהשעה הנוכחית.'); return; }
    const target = rows.find((r) => r.time === moveTime)?.cells[cell.day];
    if (target) {
      setError(`ביום ${DAY_LONG_LABELS[cell.day]} כבר יש טיול ב-${moveTime}. אפשר לשנות אותו ישירות בטבלה.`);
      return;
    }
    const { day, time } = cell;
    void run(() => onMoveCell(day, time, moveTime, picked), () => setCell(null));
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
    !c ? 'אין טיול'
      : c.kind === 'rotation' ? `בתורות: ${previewRotation(c.userIds.map((id) => usersById[id]?.name ?? '?'), c.userIds.length)}`
      : usersById[c.userId]?.name ?? '?';

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
      {/* Owner report 2026-11-10: a one-off swap (Mon↔Tue 22:00) showed on the
          week board but not here, which read as a bug. Say what this grid is. */}
      {rows.length > 0 ? (
        <RtlText style={styles.hint}>הסידור הקבוע לכל שבוע. החלפות ושינויים חד-פעמיים מופיעים בלוח השבוע.</RtlText>
      ) : null}

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
                    onPress={canEdit ? () => openCell(row.time, day) : canRequest && c?.kind === 'person' ? () => openRequest(row.time, day) : undefined}
                    disabled={!canEdit && !(canRequest && c?.kind === 'person')}
                    style={[styles.cell, c ? (tint ? { backgroundColor: tint.bg } : styles.cellRotation) : styles.cellEmpty]}
                    accessibilityRole={canEdit || (canRequest && c?.kind === 'person') ? 'button' : undefined}
                    accessibilityLabel={`יום ${DAY_LONG_LABELS[day]} ${row.time}: ${cellName(c)}${requestCells.has(`${day}|${row.time}`) ? ' (יש בקשה פתוחה)' : ''}`}
                    accessibilityHint={canRequest && c?.kind === 'person' ? 'פותח בקשה להחלפה או לשינוי קבוע' : undefined}
                  >
                    {requestCells.has(`${day}|${row.time}`) ? <View style={styles.requestDot} accessible={false} /> : null}
                    {c?.kind === 'person' ? (
                      <>
                        <Avatar emoji={user?.avatar ?? '🙂'} color={user?.color ?? colors.border} photoUrl={user?.photoUrl} size={24} />
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
            <View key={u.id} style={[styles.loadChip, styles.loadChipPerson, { backgroundColor: tints[u.id]?.bg }]}>
              <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={20} />
              <RtlText style={[styles.loadText, { color: tints[u.id]?.fg }]}>{`${u.name} · ${load.byUser[u.id]} בשבוע`}</RtlText>
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
      {canRequest && rows.length > 0 ? (
        <RtlText style={styles.hint}>לוחצים על משבצת כדי לבקש החלפה או שינוי בשגרה. נקודה כתומה מסמנת בקשה פתוחה.</RtlText>
      ) : null}
      {sentNotice ? (
        <Pressable onPress={() => setSentNotice(null)} style={styles.notice} accessibilityRole="button" accessibilityLabel={`${sentNotice} סגירה`}>
          <RtlText style={styles.noticeText} accessibilityLiveRegion="polite">{`✓ ${sentNotice}`}</RtlText>
        </Pressable>
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
                    <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={34} />
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
            {cell && moveTime !== null ? (
              <View style={styles.moveBox}>
                <RtlText style={styles.sheetSub}>{`השעה החדשה ליום ${DAY_LONG_LABELS[cell.day]} בלבד:`}</RtlText>
                <TimePickerField value={moveTime} onChange={setMoveTime} webLabel="שעה חדשה ליום הזה" />
              </View>
            ) : null}
            {error ? <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</RtlText> : null}
            {cell && moveTime !== null ? (
              <View style={styles.actions}>
                <Button
                  label={`העברה ל-${moveTime}`}
                  onPress={saveMove}
                  loading={busy}
                  disabled={busy || !picked}
                  style={styles.flex}
                  accessibilityHint={`הטיול של יום ${DAY_LONG_LABELS[cell.day]} יעבור לשעה החדשה. שאר הימים לא משתנים`}
                />
                <Button label="ביטול" variant="secondary" onPress={() => { setMoveTime(null); setError(null); }} disabled={busy} style={styles.flex} />
              </View>
            ) : (
              <>
                <View style={styles.actions}>
                  <Button label={cell ? `שמירה ליום ${DAY_SHORT_LABELS[cell.day]}` : 'שמירה'} onPress={() => saveCell(false)} loading={busy} disabled={busy} style={styles.flex} />
                  <Button label={cell ? `לכל ימי ה-${cell.time}` : 'לכל השבוע'} variant="secondary" onPress={() => saveCell(true)} disabled={busy} style={styles.flex} />
                </View>
                {cell && onMoveCell && picked ? (
                  <Button
                    label="🕒 שינוי השעה ליום הזה בלבד"
                    variant="secondary"
                    compact
                    onPress={() => { setMoveTime(cell.time); setError(null); }}
                    disabled={busy}
                    style={styles.full}
                  />
                ) : null}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* A family member asks for a change in this cell. */}
      <Modal visible={req !== null} transparent animationType="slide" onRequestClose={() => setReq(null)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !busy && setReq(null)} accessibilityLabel="סגירה" />
          {req ? (() => {
            const mine = req.ownerId === currentUserId;
            const owner = usersById[req.ownerId];
            const slot = routineSlotLabel(req.day, req.time);
            const myCells = personCells.filter((x) => x.userId === currentUserId);
            const swapOptions = mine
              ? personCells.filter((x) => x.userId !== currentUserId)
              : myCells;
            return (
              <View style={styles.sheet}>
                <RtlText style={styles.sheetTitle} accessibilityRole="header">
                  {mine ? `הטיול שלך · ${slot}` : `הטיול של ${owner?.name ?? ''} · ${slot}`}
                </RtlText>
                {reqStep === 'menu' ? (
                  <>
                    {!mine && onTakeOnce ? (
                      <>
                        <RtlText style={styles.sheetSub}>רק הפעם</RtlText>
                        <Button
                          label={`🙋 לקחת רק את הטיול הקרוב (יום ${DAY_SHORT_LABELS[req.day]})`}
                          onPress={() => void run(async () => {
                            const date = await onTakeOnce(req.day, req.time, req.ownerId);
                            setSentNotice(`הבקשה לקחת את הטיול של ${date} נשלחה ל${owner?.name ?? 'בן המשפחה'}. אם הוא/היא לא זמינים, מנהל המשפחה יכול לאשר.`);
                          }, () => setReq(null))}
                          loading={busy}
                          disabled={busy}
                          style={styles.full}
                        />
                      </>
                    ) : null}
                    <RtlText style={[styles.sheetSub, !mine && onTakeOnce ? styles.oneOffTitle : null]}>{`שינוי קבוע: בכל יום ${DAY_LONG_LABELS[req.day]}, מעכשיו והלאה`}</RtlText>
                    {mine ? (
                      <>
                        <Button label="🔁 החלפה עם טיול של מישהו אחר" variant="secondary" onPress={() => setReqStep('swapPick')} disabled={busy} style={styles.full} />
                        <Button label="➡️ העברה לבן משפחה אחר" variant="secondary" onPress={() => setReqStep('givePick')} disabled={busy} style={styles.full} />
                        <Button label="🕒 שינוי השעה" variant="secondary" onPress={() => setReqStep('time')} disabled={busy} style={styles.full} />
                      </>
                    ) : (
                      <>
                        <Button
                          label="🔁 החלפה קבועה עם טיול שלי"
                          variant="secondary"
                          onPress={() => setReqStep('swapPick')}
                          disabled={busy || myCells.length === 0}
                          style={styles.full}
                        />
                        <Button
                          label={`🙋 לקחת את הטיול הזה בכל יום ${DAY_LONG_LABELS[req.day]} (קבוע)`}
                          variant="secondary"
                          onPress={() => sendRequest({ kind: 'take', targetUserId: req.ownerId, theirDay: req.day, theirTime: req.time }, owner?.name ?? null)}
                          loading={busy}
                          disabled={busy}
                          style={styles.full}
                        />
                      </>
                    )}
                    {mine && onOneOff ? (
                      <>
                        <RtlText style={[styles.sheetSub, styles.oneOffTitle]}>רק הפעם (הטיול הקרוב ביום הזה)</RtlText>
                        <View style={styles.actions}>
                          <Button label="החלפה חד-פעמית" variant="secondary" compact onPress={() => { setReq(null); onOneOff(req.day, req.time, 'swap'); }} disabled={busy} style={styles.flex} />
                          <Button label="שינוי שעה חד-פעמי" variant="secondary" compact onPress={() => { setReq(null); onOneOff(req.day, req.time, 'time'); }} disabled={busy} style={styles.flex} />
                        </View>
                      </>
                    ) : null}
                  </>
                ) : reqStep === 'swapPick' ? (
                  <>
                    <RtlText style={styles.sheetSub}>{mine ? 'עם איזה טיול להחליף?' : 'איזה טיול שלך לתת בתמורה?'}</RtlText>
                    <ScrollView style={styles.slotList} contentContainerStyle={styles.slotListInner}>
                      {swapOptions.map((x) => {
                        const u = usersById[x.userId];
                        return (
                          <Pressable
                            key={`${x.day}|${x.time}`}
                            onPress={() => mine
                              ? sendRequest({ kind: 'swap', myDay: req.day, myTime: req.time, targetUserId: x.userId, theirDay: x.day, theirTime: x.time }, u?.name ?? null)
                              : sendRequest({ kind: 'swap', myDay: x.day, myTime: x.time, targetUserId: req.ownerId, theirDay: req.day, theirTime: req.time }, owner?.name ?? null)}
                            disabled={busy}
                            style={[styles.slotChip, { backgroundColor: tints[x.userId]?.bg }]}
                            accessibilityRole="button"
                            accessibilityLabel={`${u?.name ?? ''}, ${routineSlotLabel(x.day, x.time)}`}
                          >
                            <Avatar emoji={u?.avatar ?? '🙂'} color={u?.color ?? colors.border} photoUrl={u?.photoUrl} size={22} />
                            <RtlText style={[styles.slotText, { color: tints[x.userId]?.fg }]}>{`${mine ? `${u?.name ?? ''} · ` : ''}${routineSlotLabel(x.day, x.time)}`}</RtlText>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    <Button label="חזרה" variant="secondary" compact onPress={() => setReqStep('menu')} disabled={busy} style={styles.full} />
                  </>
                ) : reqStep === 'givePick' ? (
                  <>
                    <RtlText style={styles.sheetSub}>למי להעביר את הטיול?</RtlText>
                    <View style={styles.people}>
                      {users.filter((u) => u.id !== currentUserId).map((u) => (
                        <Pressable
                          key={u.id}
                          onPress={() => sendRequest({ kind: 'give', myDay: req.day, myTime: req.time, targetUserId: u.id }, u.name)}
                          disabled={busy}
                          style={[styles.person, { backgroundColor: tints[u.id]?.bg }]}
                          accessibilityRole="button"
                          accessibilityLabel={u.name}
                        >
                          <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={34} />
                          <RtlText style={[styles.personName, { color: tints[u.id]?.fg }]} numberOfLines={1}>{u.name}</RtlText>
                        </Pressable>
                      ))}
                    </View>
                    <Button label="חזרה" variant="secondary" compact onPress={() => setReqStep('menu')} disabled={busy} style={styles.full} />
                  </>
                ) : (
                  <>
                    <RtlText style={styles.sheetSub}>{`לאיזו שעה להזיז את הטיול של יום ${DAY_LONG_LABELS[req.day]}?`}</RtlText>
                    <TimePickerField value={reqTime} onChange={setReqTime} webLabel="בחירת שעה חדשה" />
                    <View style={styles.actions}>
                      <Button
                        label="שליחת הבקשה"
                        onPress={() => {
                          if (reqTime === req.time) { setError('בחרו שעה אחרת מהשעה הנוכחית.'); return; }
                          sendRequest({ kind: 'change_time', myDay: req.day, myTime: req.time, newTime: reqTime }, null);
                        }}
                        loading={busy}
                        disabled={busy}
                        style={styles.flex}
                      />
                      <Button label="חזרה" variant="secondary" onPress={() => setReqStep('menu')} disabled={busy} style={styles.flex} />
                    </View>
                  </>
                )}
                {error ? <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</RtlText> : null}
                <RtlText style={styles.sheetNote}>
                  {reqStep === 'time' ? 'מנהל המשפחה יאשר את השינוי.' : 'בן המשפחה השני מאשר קודם, ואחריו מנהל המשפחה.'}
                </RtlText>
              </View>
            );
          })() : null}
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
  cell: { flex: 1, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 4, paddingHorizontal: 1 },
  cellEmpty: { backgroundColor: colors.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border },
  cellRotation: { backgroundColor: '#F2EEE6' },
  cellEmoji: { fontSize: 16, lineHeight: 19 },
  cellName: { fontSize: 11, lineHeight: 13, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  cellPlus: { fontSize: 18, color: colors.textSecondary },
  loadRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs },
  loadChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  loadChipPerson: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingRight: 5 },
  loadText: { fontSize: 12, fontWeight: '800', color: colors.textPrimary },
  hint: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
  notice: { backgroundColor: '#E3F4EA', borderRadius: radii.md, paddingVertical: 8, paddingHorizontal: 12 },
  noticeText: { color: '#1E6B3E', fontSize: 13, fontWeight: '700', textAlign: 'right' },
  requestDot: { position: 'absolute', top: 4, left: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#F08A24', borderWidth: 1, borderColor: '#FFFFFF' },
  oneOffTitle: { marginTop: spacing.xs },
  moveBox: { gap: spacing.xs },
  slotList: { maxHeight: 300 },
  slotListInner: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  slotChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 6, paddingRight: 6, paddingLeft: 12 },
  slotText: { fontSize: 13, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: spacing.lg, gap: spacing.sm, maxWidth: 560, width: '100%', alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  sheetSub: { fontSize: 14, color: colors.textSecondary, textAlign: 'right' },
  sheetNote: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  people: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  person: { width: '31%', borderRadius: 14, paddingVertical: 10, alignItems: 'center', gap: 4, borderWidth: 2, borderColor: 'transparent' },
  personNone: { backgroundColor: '#F2EEE6' },
  personOn: { borderColor: colors.primaryDark },
  personEmoji: { fontSize: 22, lineHeight: 26 },
  personName: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  actions: { flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
  full: { width: '100%' },
  error: { color: colors.statusOverdue, fontSize: typography.meta.fontSize, textAlign: 'right', fontWeight: '600' },
});
