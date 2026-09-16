import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RtlText } from '../components/RtlText';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { friendlyErrorMessage } from '../lib/errorMessages';
import {
  getSystemAdminFamilyDetail,
  listSystemAdminFamilies,
  type SystemAdminFamilyDetail,
  type SystemAdminFamilyListItem,
} from '../lib/systemAdmin';

interface SystemAdminScreenProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * BATCH 4 (item A) — "🛡️ ניהול מערכת", System Admin V1 (read-only).
 *
 * Deliberately a plain Modal with local component state (list <-> detail),
 * not a new navigation stack — this repo has no @react-navigation/
 * native-stack (or equivalent) dependency, and several existing flows
 * (FamilyOnboardingScreen, every "Modal" component in components/) already
 * use exactly this pattern, so this introduces no new dependency.
 *
 * SECURITY NOTE this component leans on: rendering here at all already
 * required useSystemAdminStore().isSystemAdmin to be true (App.tsx only
 * mounts this when that's the case), but that is UI convenience only —
 * every RPC this screen calls (lib/systemAdmin.ts -> migration 0029)
 * re-checks is_system_admin() server-side on every call. This screen never
 * reads or writes authStore's familyId/currentUserId — opening a family
 * here cannot change the device's own active family or create membership,
 * by construction (there is no code path here that touches those stores).
 */
export function SystemAdminScreen({ visible, onClose }: SystemAdminScreenProps) {
  const [search, setSearch] = useState('');
  const [families, setFamilies] = useState<SystemAdminFamilyListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SystemAdminFamilyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadFamilies = useCallback(async (query?: string) => {
    setListLoading(true);
    setListError(null);
    try {
      const result = await listSystemAdminFamilies(query);
      setFamilies(result);
    } catch (e) {
      setListError(friendlyErrorMessage(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setSelectedFamilyId(null);
      setDetail(null);
      void loadFamilies();
    }
  }, [visible, loadFamilies]);

  const openFamily = async (familyId: string) => {
    setSelectedFamilyId(familyId);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const result = await getSystemAdminFamilyDetail(familyId);
      setDetail(result);
    } catch (e) {
      setDetailError(friendlyErrorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const backToList = () => {
    setSelectedFamilyId(null);
    setDetail(null);
    setDetailError(null);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <RtlText style={styles.title} accessibilityRole="header">🛡️ ניהול מערכת</RtlText>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת ניהול מערכת" hitSlop={10}>
            <RtlText style={styles.closeLink}>סגירה</RtlText>
          </Pressable>
        </View>

        {selectedFamilyId ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={backToList} accessibilityRole="button" accessibilityLabel="חזרה לרשימת המשפחות">
              <RtlText style={styles.backLink}>‹ חזרה לרשימה</RtlText>
            </Pressable>

            {detailLoading ? <ActivityIndicator color={colors.primary} style={styles.spinner} accessibilityLabel="טוען…" /> : null}
            {detailError ? (
              <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {detailError}
              </RtlText>
            ) : null}

            {detail ? (
              <View>
                <RtlText style={styles.sectionTitle}>משפחה</RtlText>
                <View style={styles.card}>
                  <RtlText style={styles.cardLine}>שם: {detail.family?.name ?? '—'}</RtlText>
                  <RtlText style={styles.cardLine}>קוד הצטרפות: {detail.family?.inviteCode ?? '—'}</RtlText>
                  <RtlText style={styles.cardLine}>
                    נוצרה: {detail.family?.createdAt ? new Date(detail.family.createdAt).toLocaleDateString('he-IL') : '—'}
                  </RtlText>
                </View>

                <RtlText style={styles.sectionTitle}>כלב/ה</RtlText>
                <View style={styles.card}>
                  {detail.dog ? (
                    <>
                      <RtlText style={styles.cardLine}>שם: {detail.dog.name}</RtlText>
                      <RtlText style={styles.cardLine}>
                        מין: {detail.dog.sex === 'male' ? 'זכר' : detail.dog.sex === 'female' ? 'נקבה' : 'לא מוגדר'}
                      </RtlText>
                      <RtlText style={styles.cardLine}>טיולים ביום: {detail.dog.walksPerDay}</RtlText>
                    </>
                  ) : (
                    <RtlText style={styles.cardLine}>אין כלב/ה רשום/ה</RtlText>
                  )}
                </View>

                <RtlText style={styles.sectionTitle}>בני משפחה ({detail.members.length})</RtlText>
                <View style={styles.card}>
                  {detail.members.length === 0 ? (
                    <RtlText style={styles.cardLine}>אין בני משפחה</RtlText>
                  ) : (
                    detail.members.map((m) => (
                      <RtlText key={m.id} style={styles.cardLine}>
                        {m.avatar} {m.name} · {m.role === 'admin' ? 'מנהל/ת' : 'בן/בת משפחה'}
                        {m.removedAt ? ' · הוסר/ה' : ''}
                        {!m.claimed ? ' · לא נתבע' : ''}
                      </RtlText>
                    ))
                  )}
                </View>

                <RtlText style={styles.sectionTitle}>בקשות פעילות ({detail.activeRequests.length})</RtlText>
                <View style={styles.card}>
                  {detail.activeRequests.length === 0 ? (
                    <RtlText style={styles.cardLine}>אין בקשות ממתינות</RtlText>
                  ) : (
                    detail.activeRequests.map((r) => (
                      <RtlText key={`${r.kind}-${r.id}`} style={styles.cardLine}>
                        {r.kind === 'swap' ? 'בקשת החלפה' : 'בקשת שינוי שעה'} · טיול {r.walkId.slice(0, 8)}
                      </RtlText>
                    ))
                  )}
                </View>

                <RtlText style={styles.sectionTitle}>טיולים אחרונים ({detail.walks.length})</RtlText>
                <View style={styles.card}>
                  {detail.walks.slice(0, 10).map((w) => (
                    <RtlText key={w.id} style={styles.cardLine}>
                      {w.date} · {w.scheduledTime} · {w.status === 'done' ? 'בוצע' : w.status === 'skipped' ? 'לא בוצע' : 'ממתין'}
                    </RtlText>
                  ))}
                </View>

                <RtlText style={styles.sectionTitle}>יומן ביקורת ({detail.recentAudit.length})</RtlText>
                <View style={styles.card}>
                  {detail.recentAudit.length === 0 ? (
                    <RtlText style={styles.cardLine}>אין רשומות</RtlText>
                  ) : (
                    detail.recentAudit.slice(0, 15).map((a) => (
                      <RtlText key={a.id} style={styles.cardLine}>
                        {new Date(a.createdAt).toLocaleString('he-IL')} · {a.action}
                      </RtlText>
                    ))
                  )}
                </View>
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <View style={styles.flex}>
            <View style={styles.searchRow}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                onSubmitEditing={() => loadFamilies(search)}
                placeholder="חיפוש לפי שם משפחה, קוד, או שם משתמש"
                placeholderTextColor={colors.textSecondary}
                style={styles.searchInput}
                textAlign="right"
                returnKeyType="search"
                accessibilityLabel="חיפוש לפי שם משפחה, קוד, או שם משתמש"
              />
              <Button label="חיפוש" onPress={() => loadFamilies(search)} compact />
            </View>

            {listLoading ? <ActivityIndicator color={colors.primary} style={styles.spinner} accessibilityLabel="טוען…" /> : null}
            {listError ? (
              <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {listError}
              </RtlText>
            ) : null}

            <ScrollView contentContainerStyle={styles.content}>
              {!listLoading && families.length === 0 ? <RtlText style={styles.cardLine}>לא נמצאו משפחות</RtlText> : null}
              {families.map((f) => (
                <Pressable
                  key={f.familyId}
                  onPress={() => openFamily(f.familyId)}
                  style={styles.familyRow}
                  accessibilityRole="button"
                  accessibilityLabel={`פתיחת פרטי משפחת ${f.familyName}, קוד ${f.inviteCode}`}
                >
                  <RtlText style={styles.familyName}>{f.familyName}</RtlText>
                  <RtlText style={styles.familyMeta}>
                    קוד: {f.inviteCode} · {f.memberCount} בני משפחה
                    {f.dogName ? ` · ${f.dogName}` : ''}
                  </RtlText>
                  <RtlText style={styles.familyMeta}>
                    מנהלים: {f.adminNames.length > 0 ? f.adminNames.join(', ') : '—'} · נוצרה{' '}
                    {new Date(f.createdAt).toLocaleDateString('he-IL')}
                  </RtlText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  closeLink: { color: colors.primaryDark, fontWeight: '700', fontSize: 15 },
  backLink: { color: colors.primaryDark, fontWeight: '700', fontSize: 14, marginBottom: 12 },
  content: { padding: 20, gap: 10, paddingBottom: 48 },
  searchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 14, alignItems: 'center' },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: colors.textPrimary,
  },
  spinner: { marginTop: 16 },
  error: { fontSize: 13, color: colors.statusOverdue, fontWeight: '600', textAlign: 'right', marginHorizontal: 20, marginTop: 10 },
  familyRow: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 4,
  },
  familyName: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  familyMeta: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary, textAlign: 'right', marginTop: 14, marginBottom: 6 },
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 4 },
  cardLine: { fontSize: 13, color: colors.textPrimary, textAlign: 'right' },
});
