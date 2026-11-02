import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { HELP_CATEGORIES, HelpItem, searchHelp } from '../lib/helpCenter';

interface HelpCenterModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * "עזרה ותמיכה": searchable FAQ plus a way to write to support. Text only,
 * no network and no external service. The support address comes from
 * EXPO_PUBLIC_SUPPORT_EMAIL (PRD §16: configuration, not code); without it
 * the contact card is simply not shown.
 */
export function HelpCenterModal({ visible, onClose }: HelpCenterModalProps) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setOpenId(null);
    }
  }, [visible]);

  const results = useMemo(() => searchHelp(query), [query]);
  const searching = query.trim().length > 0;

  const contactSupport = async () => {
    if (!supportEmail) return;
    const subject = encodeURIComponent('Walkie Doggy Link — פנייה לתמיכה');
    try {
      await Linking.openURL(`mailto:${supportEmail}?subject=${subject}`);
    } catch {
      Alert.alert('לא הצלחנו לפתוח את האימייל', `אפשר לכתוב לנו ישירות לכתובת ${supportEmail}.`);
    }
  };

  const renderItem = (item: HelpItem, categoryTitle?: string) => {
    const open = openId === item.id;
    return (
      <View key={item.id} style={styles.item}>
        <Pressable
          style={styles.questionRow}
          onPress={() => setOpenId(open ? null : item.id)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={item.question}
          testID={`help-item-${item.id}`}
        >
          <RtlText style={styles.question}>{item.question}</RtlText>
          <RtlText style={styles.toggle}>{open ? '−' : '+'}</RtlText>
        </Pressable>
        {open ? (
          <View style={styles.answerBox}>
            {categoryTitle ? <RtlText style={styles.resultCategory}>{categoryTitle}</RtlText> : null}
            <RtlText style={styles.answer}>{item.answer}</RtlText>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת עזרה ותמיכה">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title} accessibilityRole="header">💬 עזרה ותמיכה</RtlText>

          <TextInput
            value={query}
            onChangeText={(text) => { setQuery(text); setOpenId(null); }}
            placeholder="חיפוש: התראות, החלפה, GPS…"
            placeholderTextColor={colors.textSecondary}
            style={styles.search}
            textAlign="right"
            returnKeyType="search"
            accessibilityLabel="חיפוש בשאלות הנפוצות"
            testID="help-search"
          />

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            {searching ? (
              results.length > 0 ? (
                <View style={styles.card}>{results.map(({ item, categoryTitle }) => renderItem(item, categoryTitle))}</View>
              ) : (
                <RtlText style={styles.empty}>לא מצאנו תשובה לחיפוש הזה. אפשר לנסות מילה אחרת{supportEmail ? ', או לכתוב לנו.' : '.'}</RtlText>
              )
            ) : (
              HELP_CATEGORIES.map((category) => (
                <View key={category.id} style={styles.category}>
                  <RtlText style={styles.categoryTitle}>{category.title}</RtlText>
                  <View style={styles.card}>{category.items.map((item) => renderItem(item))}</View>
                </View>
              ))
            )}

            {supportEmail ? (
              <View style={styles.contact}>
                <RtlText style={styles.contactTitle}>לא מצאתם תשובה?</RtlText>
                <RtlText style={styles.contactText}>כתבו לנו ונחזור אליכם. כדאי לצרף צילום מסך.</RtlText>
                <Button label="✉️ כתבו לנו" variant="secondary" onPress={() => void contactSupport()} />
              </View>
            ) : null}
          </ScrollView>

          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: spacing.lg, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  search: {
    ...typography.body,
    fontWeight: '500',
    color: colors.textPrimary,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  category: { marginBottom: spacing.md },
  categoryTitle: { ...typography.sectionTitle, fontSize: 15, color: colors.textPrimary, textAlign: 'right', marginBottom: spacing.xs },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: 'hidden' },
  item: { borderBottomWidth: 1, borderBottomColor: colors.border },
  questionRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 48 },
  question: { ...typography.body, fontSize: 15, flex: 1, color: colors.textPrimary, textAlign: 'right' },
  toggle: { fontSize: 20, fontWeight: '700', color: colors.primaryDark, width: 20, textAlign: 'center' },
  answerBox: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
  resultCategory: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  answer: { ...typography.meta, fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'right' },
  empty: { ...typography.meta, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },
  contact: { backgroundColor: colors.primarySoft, borderRadius: radii.md, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  contactTitle: { ...typography.cardTitle, color: colors.primaryDark, textAlign: 'right' },
  contactText: { ...typography.meta, color: colors.textSecondary, textAlign: 'right', marginBottom: spacing.xs },
  closeButton: { marginTop: spacing.sm },
});
