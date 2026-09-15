import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { Avatar } from './Avatar';
import { Button } from './Button';
import type { FamilyUser } from '../types';
import { enableWebPush, getWebPushStatus, type WebPushStatus } from '../lib/webPush';

interface RemindersModalProps {
  visible: boolean;
  users: FamilyUser[];
  effectiveFamilyRole: 'admin' | 'member' | null;
  effectiveUserId: string | null | undefined;
  onSetReminderEnabled: (userId: string, enabled: boolean) => void;
  onClose: () => void;
}

/** Section 12: "🔔 תזכורות" — the reminders switch-list, moved into its own focused area instead of sitting on the main Settings screen. */
export function RemindersModal({
  visible,
  users,
  effectiveFamilyRole,
  effectiveUserId,
  onSetReminderEnabled,
  onClose,
}: RemindersModalProps) {
  const [webPushStatus, setWebPushStatus] = useState<WebPushStatus>('default');
  const [webPushBusy, setWebPushBusy] = useState(false);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') {
      return;
    }

    void getWebPushStatus().then(setWebPushStatus);
  }, [visible]);

  const handleEnableWebPush = async () => {
    try {
      setWebPushBusy(true);
      const status = await enableWebPush();
      setWebPushStatus(status);

      if (status === 'subscribed') {
        Alert.alert('התראות הופעלו', 'המכשיר הזה רשום לקבלת התראות.');
      } else if (status === 'denied') {
        Alert.alert(
          'ההתראות חסומות',
          'יש לאפשר התראות בהגדרות הדפדפן או המכשיר.'
        );
      } else if (status === 'unsupported') {
        Alert.alert(
          'לא נתמך',
          'Web Push אינו נתמך בסביבה הנוכחית.'
        );
      }
    } catch (error) {
      console.error('Failed to enable Web Push', error);
      Alert.alert(
        'לא ניתן להפעיל התראות',
        'אירעה שגיאה בעת רישום המכשיר להתראות.'
      );
    } finally {
      setWebPushBusy(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="סגירת חלון תזכורות"
      >
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title}>🔔 תזכורות</RtlText>
          <ScrollView style={styles.scroll}>
{Platform.OS === 'web' && (
  <View style={styles.webPushSection}>
    <RtlText style={styles.webPushTitle}>התראות במכשיר הזה</RtlText>

    <RtlText style={styles.webPushText}>
      {webPushStatus === 'subscribed'
        ? 'ההתראות פעילות במכשיר הזה.'
        : webPushStatus === 'denied'
          ? 'ההתראות חסומות בהגדרות הדפדפן או המכשיר.'
          : webPushStatus === 'unsupported'
            ? 'המכשיר או הדפדפן הזה אינם תומכים ב-Web Push.'
            : 'אפשר לקבל התראות גם כשהאפליקציה אינה פתוחה.'}
    </RtlText>

    {webPushStatus !== 'subscribed' &&
      webPushStatus !== 'denied' &&
      webPushStatus !== 'unsupported' && (
        <Button
          label={webPushBusy ? 'מפעיל התראות...' : 'אפשר התראות'}
          onPress={handleEnableWebPush}
          disabled={webPushBusy}
          style={styles.webPushButton}
        />
      )}
  </View>
)}
            {users
              .filter((u) => !u.removedAt)
              .map((u) => (
                <View key={u.id} style={styles.row}>
                  <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={36} />
                  <RtlText style={styles.name} numberOfLines={1}>
                    {u.name}
                  </RtlText>
                  <Switch
                    value={u.remindersEnabled}
                    onValueChange={(v) => onSetReminderEnabled(u.id, v)}
                    disabled={effectiveFamilyRole !== 'admin' && u.id !== effectiveUserId}
                    accessibilityLabel={`תזכורות עבור ${u.name}`}
                  />
                </View>
              ))}
          </ScrollView>
          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '75%' },
  // BUG FIX (real-device regression) — see DogDetailsModal.tsx's matching
  // comment for the full mechanism: `flex: 1` here forced the ScrollView's
  // flex-basis to 0 inside a `sheet` whose height is auto (capped only by
  // maxHeight, no definite size of its own), which had nothing to grow
  // into and collapsed the whole sheet. `flexGrow: 0, flexShrink: 1`
  // restores content-hugging sizing while still letting it scroll/shrink
  // down to the maxHeight cap once there are enough users to overflow it.
  scroll: { flexGrow: 0, flexShrink: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
webPushSection: {
  paddingVertical: 14,
  paddingHorizontal: 4,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: colors.border,
  marginBottom: 8,
},

webPushTitle: {
  fontSize: 16,
  fontWeight: '700',
  color: colors.textPrimary,
  textAlign: 'right',
  marginBottom: 6,
},

webPushText: {
  fontSize: 14,
  color: colors.textSecondary,
  textAlign: 'right',
  lineHeight: 20,
},

webPushButton: {
  marginTop: 10,
},  
closeButton: { marginTop: 14 },
});
