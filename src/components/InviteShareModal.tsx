import React, { useState } from 'react';
import { Alert, Modal, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import QRCode from 'react-native-qrcode-svg';
import { copyToClipboard } from '../lib/clipboard';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { Button } from './Button';
import { ConfirmModal } from './ConfirmModal';
import { revokeFamilyInvite, type CreatedFamilyInvite } from '../lib/invites';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { buildInviteLinkText, formatInviteExpiry } from '../logic/familyInvites';

/**
 * Round 5A — fixed pixel size for the in-modal QR code. Chosen to be large
 * enough to scan reliably on typical phone screens while leaving room for
 * the rest of the sheet's content; not derived from any device measurement,
 * this is a static, platform-neutral value (no Platform.OS branching).
 */
const QR_SIZE = 180;

interface InviteShareModalProps {
  visible: boolean;
  /** The member this invite is for — display only, never sent to any RPC from this component. */
  targetName: string;
  /**
   * The just-created invite, RAW TOKEN INCLUDED. Deliberately held by the
   * PARENT (MemberDetailsModal) as plain component state, not this
   * component's own — either way it lives only in memory for as long as
   * this modal is mounted/visible. Never written to AsyncStorage, the
   * Zustand store, LocalRepository, or SyncQueue, and never logged — see
   * lib/invites.ts's own doc comment on why createFamilyInvite() returns it
   * only for this one immediate use. Closing this modal (onClose) is the
   * parent's cue to drop its reference entirely (setCreatedInvite(null)),
   * after which the raw token is intentionally unrecoverable — regenerating
   * is the only way to get a new shareable one (see createInviteButtonLabel
   * in logic/familyInvites.ts).
   */
  invite: CreatedFamilyInvite | null;
  /** Called after a successful revoke — the parent should clear its invite state and refresh list_family_invites() metadata. */
  onRevoked: () => void;
  onClose: () => void;
}

/**
 * The one-time "here is the new invite" sheet shown immediately after
 * createFamilyInvite() succeeds. Shows the real, clickable invite link for
 * copy/share, a QR encoding that same link, and lets the admin revoke it
 * again from the same place.
 *
 * Family Lifecycle repair — on web this is a real HTTPS URL
 * (buildInviteLinkText(rawToken, window.location.origin)) that the
 * recipient's device resolves server-side on tap: opening it routes
 * straight into the invite-confirmation flow (see
 * FamilyOnboardingScreen's launch-URL detection), no manual paste or
 * generic onboarding required. On native, where there is no web origin to
 * build a URL from, this falls back to the legacy `dogwalkfamily://`
 * display/copy/share-only form (not yet a working deep link there — see
 * buildInviteLinkText()'s own doc comment).
 *
 * The QR renders the SAME `link` value already used by Copy/Share, as a
 * purely visual fourth representation — by construction, a stale/obsolete
 * QR cannot exist: it is rendered live from this component's own `invite`
 * prop on every render (via the react-native-qrcode-svg + react-native-svg
 * pair), never cached, never written to a file/Photos, never persisted to
 * AsyncStorage/the Zustand store/LocalRepository/SyncQueue, and never
 * logged. Closing this modal is still the only way the raw token becomes
 * unreachable (via the parent's setCreatedInvite(null)), and the QR
 * unmounts along with everything else in this component — there is no
 * separate reopen/recovery path for the QR image itself.
 */
export function InviteShareModal({ visible, targetName, invite, onRevoked, onClose }: InviteShareModalProps) {
  const [revoking, setRevoking] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!invite) return null;

  const webOrigin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null;
  const link = buildInviteLinkText(invite.rawToken, webOrigin);
  const isClickableLink = Boolean(webOrigin);
  const expiryText = formatInviteExpiry(invite.expiresAt);

  const copyLink = async () => {
    // BATCH 4 (item E): try/catch-guarded (via the shared helper) with real
    // failure feedback — the link itself stays visible/selectable in
    // `linkText` below either way (manual-copy fallback).
    const ok = await copyToClipboard(link);
    if (ok) {
      Alert.alert('הקישור הועתק', 'קישור ההזמנה הועתק ללוח.');
    } else {
      Alert.alert('לא הצלחנו להעתיק', 'אפשר להעתיק ידנית — לחצו לחיצה ארוכה על הקישור למעלה כדי לבחור ולהעתיק אותו.');
    }
  };

  const shareLink = async () => {
    try {
      // A clean, directly-clickable message: the link stands alone on its
      // own line with no trailing punctuation/text immediately beside it,
      // so WhatsApp/SMS/email reliably render it as a tappable link.
      // parseInviteInput() still recognizes the link anywhere inside a
      // larger pasted message as a fallback, in case a recipient copies
      // the whole text instead of tapping it directly.
      await Share.share({
        message: `הוזמנת להצטרף למשפחה באפליקציית Walkie Doggy!\n\n${link}`,
      });
    } catch {
      // best-effort — sharing is a convenience, not critical (matches
      // SettingsScreen.shareInviteCode's own established pattern).
    }
  };

  const doRevoke = async () => {
    setRevoking(true);
    setError(null);
    try {
      await revokeFamilyInvite(invite.id);
      setConfirmingRevoke(false);
      onRevoked();
    } catch (e) {
      setConfirmingRevoke(false);
      setError(friendlyErrorMessage(e));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={`סגירת הזמנה ל${targetName}`}
      >
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title} accessibilityRole="header">הזמנה ל{targetName}</RtlText>
          {expiryText ? <RtlText style={styles.expiry}>ההזמנה בתוקף עד {expiryText}</RtlText> : null}

          <RtlText style={styles.explainer}>
            {isClickableLink
              ? 'שלחו את ההזמנה לבן/בת המשפחה — לחיצה על הקישור (או סריקת הקוד) פותחת את ההזמנה אוטומטית, בלי להדביק או להקליד כלום. הקישור תקף למכשיר חדש בלבד ואינו ניתן לשחזור לאחר סגירת המסך הזה — במידת הצורך ניתן ליצור הזמנה חדשה בכל עת.'
              : 'שלחו את ההזמנה לבן/בת המשפחה כדי שיוכלו להצטרף. אפשר להדביק במסך "יש לי הזמנה" את הקישור בלבד או את כל הודעת השיתוף — האפליקציה תחלץ את ההזמנה אוטומטית. הקישור תקף למכשיר חדש בלבד ואינו ניתן לשחזור לאחר סגירת המסך הזה — במידת הצורך ניתן ליצור הזמנה חדשה בכל עת.'}
          </RtlText>
          {!isClickableLink ? (
            <RtlText style={styles.notYetOpenable}>
              שימו לב: במכשיר הזה הקישור מיועד להעתקה/שיתוף בלבד ואינו נפתח אוטומטית באפליקציה בעת לחיצה או סריקה.
            </RtlText>
          ) : null}

          <View style={styles.linkCard}>
            <RtlText style={styles.linkText} selectable numberOfLines={3}>
              {link}
            </RtlText>
          </View>

          <View style={styles.qrSection}>
            <RtlText style={styles.qrLabel}>אפשר גם לסרוק את הקוד הזה במקום להעתיק את הקישור</RtlText>
            <View style={styles.qrCard}>
              <QRCode value={link} size={QR_SIZE} backgroundColor="#ffffff" color="#000000" />
            </View>
          </View>

          <View style={styles.actionsRow}>
            {/* Round 6B: compact — same flex:1 paired-button row that ConfirmModal
                already uses `compact` for (see Button's `compact` prop doc comment).
                Fixes real-iPhone truncation of these Hebrew labels. */}
            <Button label="העתק קישור" variant="secondary" onPress={copyLink} style={styles.actionButton} compact />
            <Button label="שתף קישור" variant="secondary" onPress={shareLink} style={styles.actionButton} compact />
          </View>

          <Button
            label="בטל הזמנה"
            variant="danger"
            accessibilityHint="יוצג אישור לפני ביטול ההזמנה"
            onPress={() => setConfirmingRevoke(true)}
            style={styles.revokeButton}
          />

          {error ? (
            <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </RtlText>
          ) : null}

          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>

      <ConfirmModal
        visible={confirmingRevoke}
        title="ביטול ההזמנה?"
        message="הקישור שהוצג יפסיק לעבוד מיד. ניתן ליצור הזמנה חדשה בכל עת."
        confirmLabel="בטל הזמנה"
        cancelLabel="חזרה"
        loading={revoking}
        onConfirm={doRevoke}
        onCancel={() => {
          if (revoking) return;
          setConfirmingRevoke(false);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, gap: 10 },
  title: { fontSize: 19, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  expiry: { fontSize: typography.meta.fontSize, color: colors.textSecondary, textAlign: 'right' },
  explainer: { fontSize: typography.meta.fontSize, color: colors.textSecondary, textAlign: 'right', lineHeight: 19 },
  notYetOpenable: { fontSize: 12, color: colors.textSecondary, textAlign: 'right', lineHeight: 17, fontStyle: 'italic' },
  linkCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16,
    padding: 14,
    marginTop: spacing.xs,
  },
  linkText: { fontSize: 14, color: colors.textPrimary, textAlign: 'left', writingDirection: 'ltr' },
  qrSection: { alignItems: 'center', marginTop: 6, gap: spacing.sm },
  qrLabel: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  qrCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: spacing.xs },
  actionButton: { flex: 1 },
  revokeButton: { marginTop: spacing.xs },
  error: { fontSize: typography.meta.fontSize, color: colors.statusOverdue, textAlign: 'right' },
  closeButton: { marginTop: spacing.xs },
});
