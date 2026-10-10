import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { is24HourTime, pickerDateToTime, timeToPickerDate } from '../logic/timeInput';

interface TimePickerFieldProps {
  value: string;
  onChange: (time: string) => void;
  webLabel: string;
  androidLabel?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Native picker on iOS/Android and a fully custom, app-controlled picker sheet on Web (see this file's own web-branch doc comment for why). */
export function TimePickerField({ value, onChange, webLabel, androidLabel = 'שנה שעה' }: TimePickerFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [webSheetOpen, setWebSheetOpen] = useState(false);

  useEffect(() => setPickerOpen(false), [value]);

  const handleNativeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setPickerOpen(false);
    if (event.type !== 'dismissed' && selected) onChange(pickerDateToTime(selected));
  };

  /**
   * Real-device QA fix — real-iPhone screenshot showed the OS/Safari
   * native <input type="time"> picker (used here previously) rendering
   * as a browser-drawn overlay whose position/size this page cannot
   * control. Inside RuleFormModal's bottom sheet, that overlay covered
   * the MIDDLE of the sheet — the "אחראי/ת לטיול" assignee section and
   * the Save/Cancel buttons below it stayed hidden behind it until the
   * picker was dismissed. A real interaction blocker (the form could not
   * be completed), not a cosmetic issue — related to, but distinct from,
   * a973a98's "a focused input eats the first tap elsewhere" fix, which
   * patched one symptom of the same underlying native control.
   *
   * Fix: stop using any native time-entry control on web entirely. This
   * is now a plain button showing the current value; tapping it opens
   * WebTimePickerSheet below — a Modal built entirely out of this app's
   * own Views/Pressables, with no OS picker chrome at all. It has its
   * own explicit "אישור"/"ביטול" controls, so a choice is always
   * explicit, the sheet always closes completely back to an unobstructed
   * RuleFormModal, and nothing is ever left focused behind it (there is
   * no focusable native form element to begin with, so the first-tap-
   * swallowing bug a973a98 fixed cannot recur here either).
   */
  if (Platform.OS === 'web') {
    return (
      <>
        <Pressable style={webStyles.field} onPress={() => setWebSheetOpen(true)} accessibilityRole="button" accessibilityLabel={`${webLabel}, שעה נוכחית ${value}, לחצו לשינוי`}>
          <RtlText style={webStyles.fieldText}>{value || pickerDateToTime(new Date())}</RtlText>
        </Pressable>
        <WebTimePickerSheet
          visible={webSheetOpen}
          value={value}
          title={webLabel}
          onConfirm={(next) => {
            // Close first so Safari/PWA fully unmounts the nested picker
            // modal before the parent edit form re-renders with its new
            // controlled value. Real-iPhone QA showed that updating the
            // parent while this nested Modal was still mounted could leave
            // the visible field on the old time even though Confirm fired.
            setWebSheetOpen(false);
            onChange(next);
          }}
          onCancel={() => setWebSheetOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <Pressable style={styles.valueButton} onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel={`${webLabel}, שעה נוכחית ${value}, לחצו לשינוי`}>
        <RtlText style={styles.value}>{value || pickerDateToTime(new Date())}</RtlText>
      </Pressable>
      {pickerOpen ? (
        <DateTimePicker value={is24HourTime(value) ? timeToPickerDate(value) : new Date()} mode="time" is24Hour display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={handleNativeChange} />
      ) : null}
    </>
  );
}

interface WebTimePickerSheetProps {
  visible: boolean;
  value: string;
  title: string;
  onConfirm: (time: string) => void;
  onCancel: () => void;
}

/**
 * The actual custom picker UI (see TimePickerField's own web-branch doc
 * comment for why this exists instead of the browser's native
 * <input type="time">). Two independently scrollable hour/minute lists
 * plus explicit confirm/cancel controls — no native form element, so
 * there is no OS picker chrome that can overlay anything else on screen,
 * and dismissing it is always one of these two deliberate actions, never
 * a tap elsewhere.
 */
function WebTimePickerSheet({ visible, value, title, onConfirm, onCancel }: WebTimePickerSheetProps) {
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);

  // Re-seed from the field's current value every time the sheet opens —
  // both the "add a new time" (default) and "edit an existing time"
  // flows share this same field/prop, so this is the one place that
  // needs to handle both: start from whatever `value` already is, not
  // wherever the columns were last left scrolled to.
  useEffect(() => {
    if (!visible) return;
    const parsed = is24HourTime(value) ? value : pickerDateToTime(new Date());
    const [h, m] = parsed.split(':').map(Number);
    setHour(h);
    setMinute(m);
  }, [visible, value]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={webStyles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="סגירת בחירת שעה"
        />
        <View style={webStyles.card}>
          <RtlText style={webStyles.title} accessibilityRole="header">{title}</RtlText>
          <View style={webStyles.columns}>
            <NumberColumn values={HOURS} selected={hour} onSelect={setHour} unitLabel="שעה" />
            <RtlText style={webStyles.colon}>:</RtlText>
            <NumberColumn values={MINUTES} selected={minute} onSelect={setMinute} unitLabel="דקה" />
          </View>
          <View style={webStyles.actions}>
            <Button
              label="אישור"
              accessibilityLabel="אישור בחירת שעה"
              onPress={() => onConfirm(`${pad2(hour)}:${pad2(minute)}`)}
              style={webStyles.flex}
            />
            <Button
              label="ביטול"
              accessibilityLabel="ביטול בחירת שעה"
              onPress={onCancel}
              variant="secondary"
              style={webStyles.flex}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface NumberColumnProps {
  values: number[];
  selected: number;
  onSelect: (n: number) => void;
  unitLabel: string;
}

function NumberColumn({ values, selected, onSelect, unitLabel }: NumberColumnProps) {
  const scrollRef = useRef<ScrollView>(null);
  const rowHeight = 44;
  useEffect(() => {
    // Scroll to the currently selected value whenever the picker opens or a
    // different field value is supplied. Two spacer rows center edge values.
    const frame = setTimeout(() => scrollRef.current?.scrollTo({ y: selected * rowHeight, animated: false }), 0);
    return () => clearTimeout(frame);
  }, [selected]);
  return (
    <View style={webStyles.column} accessibilityLabel={unitLabel}>
      <RtlText style={webStyles.wheelLabel}>{unitLabel}</RtlText>
      <ScrollView
        ref={scrollRef}
        style={webStyles.wheel}
        showsVerticalScrollIndicator={false}
        snapToInterval={rowHeight}
        decelerationRate="fast"
        nestedScrollEnabled
        onMomentumScrollEnd={(event) => {
          const index = Math.max(0, Math.min(values.length - 1, Math.round(event.nativeEvent.contentOffset.y / rowHeight)));
          onSelect(values[index]);
        }}
        onScrollEndDrag={(event) => {
          const index = Math.max(0, Math.min(values.length - 1, Math.round(event.nativeEvent.contentOffset.y / rowHeight)));
          onSelect(values[index]);
        }}
      >
        <View style={{ height: rowHeight }} />
        {values.map((n) => (
          <Pressable key={n} onPress={() => onSelect(n)}
            style={[webStyles.columnRow, n === selected && webStyles.columnRowActive]}
            accessibilityRole="button" accessibilityLabel={`${unitLabel} ${pad2(n)}`}
            accessibilityState={{ selected: n === selected }}>
            <RtlText style={[webStyles.columnRowText, n === selected && webStyles.columnRowTextActive]}>{pad2(n)}</RtlText>
          </Pressable>
        ))}
        <View style={{ height: rowHeight }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  valueButton: { minHeight: 52, justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  value: { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: 14, padding: 14, fontSize: 20, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  button: { flex: 1.25 },
});

const COLUMN_ROW_HEIGHT = 44;

const webStyles = StyleSheet.create({

  field: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  fieldText: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', writingDirection: 'ltr' },

  // Centered dialog, not a bottom sheet anchored under RuleFormModal's own
  // sheet — a deliberately separate, self-contained step (see the
  // web-branch doc comment above): while it is open there is nothing
  // else on screen to obstruct, and closing it (via either button below)
  // always returns to RuleFormModal exactly as it was, fully visible.
  backdrop: { flex: 1, backgroundColor: '#00000055', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.xl },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.md },
  // LTR so hour reads to the left of minute (standard HH:mm order) even
  // though the surrounding form is RTL Hebrew — same convention the
  // previous native web input used (`direction: 'ltr'`).
  columns: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, direction: 'ltr' },
  column: { width: 100 },
  wheel: { height: 132, flexGrow: 0 },
  wheelLabel: { textAlign: 'center', fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  stepControls: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 8 },
  stepButton: { width: 38, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 10 },
  colon: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  columnRow: { height: COLUMN_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm },
  columnRowActive: { backgroundColor: colors.primarySoft },
  columnRowText: { fontSize: 20, fontWeight: '600', color: colors.textSecondary, writingDirection: 'ltr' },
  columnRowTextActive: { color: colors.primaryDark, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  flex: { flex: 1 },
});
