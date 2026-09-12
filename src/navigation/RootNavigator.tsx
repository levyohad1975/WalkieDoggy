import React, { useEffect } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreen } from '../screens/HomeScreen';
import { ScheduleScreen } from '../screens/ScheduleScreen';
import { FamilyScreen } from '../screens/FamilyScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { StatisticsScreen } from '../screens/StatisticsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ImpersonationBanner } from '../components/ImpersonationBanner';
import { colors } from '../theme/colors';
import { nativeDirection } from '../theme/tokens';
import { useAuthStore, useEffectiveUserId } from '../store/authStore';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useRequestsStore } from '../store/requestsStore';
import { subscribeToFamilyChanges } from '../lib/realtime';
import { DEMO_FAMILY } from '../data/demoData';
import { canAccessHistoryScreen, canAccessStatisticsScreen } from '../logic/permissions';

export type RootTabParamList = {
  Home: undefined;
  Schedule: undefined;
  Family: undefined;
  History: undefined;
  Statistics: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const TAB_ICON: Record<keyof RootTabParamList, string> = {
  Home: '🏠',
  Schedule: '📅',
  Family: '👪',
  History: '📖',
  Statistics: '📈',
  Settings: '⚙️',
};

const TAB_LABEL: Record<keyof RootTabParamList, string> = {
  Home: 'בית',
  Schedule: 'לוח זמנים',
  Family: 'משפחה',
  History: 'היסטוריה',
  Statistics: 'סטטיסטיקה',
  Settings: 'הגדרות',
};

const PHYSICAL_TAB_ORDER: (keyof RootTabParamList)[] = [
  'Settings',
  'Statistics',
  'History',
  'Family',
  'Schedule',
  'Home',
];

/**
 * A physically deterministic tab bar. React Navigation/iOS can re-evaluate
 * RTL mirroring when Dynamic Type changes at runtime; rendering the buttons
 * ourselves in an explicitly-LTR row prevents that transient flip while the
 * Hebrew labels themselves remain RTL text.
 */
function FixedPhysicalTabBar({ state, descriptors, navigation, canSeeHistoryTab, canSeeStatisticsTab }: BottomTabBarProps & { canSeeHistoryTab: boolean; canSeeStatisticsTab: boolean }) {
  const insets = useSafeAreaInsets();
  const routeByName = Object.fromEntries(state.routes.map((route) => [route.name, route]));

  const buttons = PHYSICAL_TAB_ORDER.map((name) => {
        const route = routeByName[name];
        if (!route) return null;
        if (name === 'History' && !canSeeHistoryTab) return null;
        if (name === 'Statistics' && !canSeeStatisticsTab) return null;
        const routeIndex = state.routes.findIndex((r) => r.key === route.key);
        const focused = state.index === routeIndex;
        const options = descriptors[route.key]?.options;
        const tint = focused ? colors.primary : colors.textSecondary;
        return (
          <Pressable
            key={route.key}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={options?.tabBarAccessibilityLabel ?? TAB_LABEL[name]}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1 }}
          >
            <RtlText allowFontScaling={false} style={{ fontSize: 20, color: tint }}>{TAB_ICON[name]}</RtlText>
            <RtlText allowFontScaling={false} numberOfLines={1} style={{ fontSize: 11, fontWeight: '600', color: tint, textAlign: 'center', writingDirection: 'rtl' }}>{TAB_LABEL[name]}</RtlText>
          </Pressable>
        );
      });

  return (
    <View style={{ height: 56 + insets.bottom, paddingBottom: Math.max(8, insets.bottom), paddingTop: 6, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: Platform.OS === 'web' ? 1000 : undefined,
          alignSelf: 'center',
          flexDirection: 'row',
          ...nativeDirection('ltr'),
        }}
      >
        {buttons}
      </View>
    </View>
  );
}


export function RootNavigator() {
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  // BATCH 3 (Task 4 — navigation visibility): hide the History/Statistics
  // tabs when the current EFFECTIVE member (respects impersonation/Test
  // Mode, same as every other effective-identity read in this app) lacks
  // that effective permission — role default, overridden per-member by a
  // Family Admin (migration 0023 + logic/permissions.ts's resolver).
  // Hiding the tab is a convenience, NOT the security boundary: both
  // screens also enforce this themselves at render time (see
  // HistoryScreen.tsx / StatisticsScreen.tsx) so stale navigation state, a
  // deep link, or state restoration can never bypass it just because the
  // tab happened to be hidden when the app launched.
  //
  // CORRECTED (Batch 3 final review correction, item 4): this used to call
  // the plain canViewHistory()/canViewStatistics() resolvers directly
  // against permissionOverrides, which default to the role default (true)
  // whenever no override row is found — including while permissionOverrides
  // is still `[]` simply because loadPermissionOverrides() hasn't resolved
  // yet (cold start, or any focus-triggered family reload elsewhere in the
  // app). That let the tab transiently SHOW as allowed for a member whose
  // actual override denies them, before the real override data ever
  // arrived. canAccessHistoryScreen()/canAccessStatisticsScreen() (the same
  // fail-closed gate HistoryScreen.tsx/StatisticsScreen.tsx already use at
  // the screen boundary) fail closed unless permissionOverridesStatus is
  // exactly 'loaded' — reusing the SAME PermissionLoadStatus signal
  // familyStore already tracks, not a new one invented for navigation.
  // Disclosed trade-off: because loadPermissionOverrides() re-enters
  // 'loading' on every family reload (e.g. HomeScreen's own
  // useFocusEffect), a permitted member's tab can briefly disappear and
  // reappear during a background refresh rather than staying visible
  // throughout — this is the same fail-closed cadence the destination
  // screens themselves already have (a screen the member is ON also blocks
  // its content while its own permissionOverridesStatus is mid-reload), so
  // navigation is now consistent with the screens rather than able to
  // disagree with them, and no protected content is ever exposed either way.
  const effectiveUserId = useEffectiveUserId();
  const permissionOverrides = useFamilyStore((s) => s.permissionOverrides);
  const permissionOverridesStatus = useFamilyStore((s) => s.permissionOverridesStatus);
  const canSeeHistoryTab = canAccessHistoryScreen(effectiveUserId, permissionOverrides, permissionOverridesStatus);
  const canSeeStatisticsTab = canAccessStatisticsScreen(effectiveUserId, permissionOverrides, permissionOverridesStatus);
  // Gates the wrapping SafeAreaView itself (not just the banner's own
  // internal null-check) — otherwise an empty top-inset-padded View would
  // sit above every screen at all times, silently pushing everything down
  // even while nobody is being impersonated.
  const impersonatingUserId = useAuthStore((s) => s.impersonatingUserId);
  // FINAL CORRECTION PASS — Deliverable 3F (navigation, real bug fix): the
  // tab bar previously set a FIXED `height: 64` — specifying an explicit
  // height on tabBarStyle opts OUT of react-navigation's own automatic
  // safe-area-bottom-inset handling, so on any notched/home-indicator
  // iPhone the tab bar's tap targets and labels would sit uncomfortably
  // close to (or under) the home indicator, with no bottom breathing room.
  // Computed explicitly from insets.bottom below instead — a real,
  // concrete safe-area bug, not a destination/structure change.
  const insets = useSafeAreaInsets();

  // Best-effort multi-device live sync (no-op, and safe, in local/demo mode
  // — see subscribeToFamilyChanges). Every screen also loads on its own
  // mount/pull-to-refresh regardless, so a failed/unavailable subscription
  // here never leaves the app stuck on stale data.
  useEffect(() => {
    // P0 FIX — stale request status across devices: this callback used to
    // reload only useFamilyStore/useScheduleStore. useRequestsStore (swap +
    // time-change requests) was never reloaded here, so a request
    // created/approved/rejected on another device never updated this
    // device's pending badge or per-walk request status until a manual
    // pull-to-refresh — even once walk_swap_requests/time_change_requests
    // were added to WATCHED_TABLES (src/lib/realtime.ts) and to the
    // server-side realtime publication (migrations/
    // 0017_realtime_publication.sql), nothing on THIS side ever acted on
    // that change notification for the requests store specifically.
    // useRequestsStore.load() takes no arguments (it derives the caller's
    // own family membership server-side via RLS, same as
    // listSwapRequests/listTimeChangeRequests) — see src/store/
    // requestsStore.ts.
    const unsubscribe = subscribeToFamilyChanges(familyId, () => {
      void useFamilyStore.getState().load(familyId);
      void useScheduleStore.getState().load(familyId);
      void useRequestsStore.getState().load();
    });
    return unsubscribe;
  }, [familyId]);

  return (
    <View style={{ flex: 1 }}>
      {/* QA/UX round, Part F2 fix: rendered ONCE here, at the navigator
          root, so it stays visible across every tab while real-
          impersonation is active — see ImpersonationBanner.tsx's doc
          comment for why this used to only appear on Home. Its own
          top-edge SafeAreaView keeps it clear of the notch/status bar;
          each screen below still applies its own top safe-area padding
          independently, which is harmless (a little extra breathing room
          under the banner, not a layout bug). */}
      {impersonatingUserId ? (
        <SafeAreaView edges={['top']} style={{ backgroundColor: colors.primaryDark }}>
          <ImpersonationBanner />
        </SafeAreaView>
      ) : null}
      <NavigationContainer direction="rtl">
      <Tab.Navigator
        initialRouteName="Home"
        tabBar={(props) => <FixedPhysicalTabBar {...props} canSeeHistoryTab={canSeeHistoryTab} canSeeStatisticsTab={canSeeStatisticsTab} />}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: {
            height: 56 + insets.bottom,
            paddingBottom: Math.max(8, insets.bottom),
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarAllowFontScaling: false,
          tabBarIcon: () => <RtlText style={{ fontSize: 20 }}>{TAB_ICON[route.name as keyof RootTabParamList]}</RtlText>,
          tabBarLabel: TAB_LABEL[route.name as keyof RootTabParamList],
        })}
      >
        {/* The app itself is forced to RTL in index.ts, so React Navigation
            must receive the same direction. In RTL, the bottom-tab bar
            mirrors the declared route order. Declaring Home first therefore
            places Home at the physical RIGHT edge and Settings last at the
            physical LEFT edge after a full app restart. Keeping navigation
            direction aligned with I18nManager also avoids the transient
            pre-restart/post-restart mismatch we saw during Dynamic Type tests. */}
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Schedule" component={ScheduleScreen} />
        <Tab.Screen name="Family" component={FamilyScreen} />
        {/* BATCH 3 (Task 4): conditionally-rendered Tab.Screen — omitting it
            entirely (not just hiding a tab bar button) means it also can't
            be reached via navigation.navigate('History'/...) from stale
            code, and FixedPhysicalTabBar's own `if (!route) return null`
            above already handles a route that doesn't exist this render. */}
        <Tab.Screen name="History" component={HistoryScreen} />
        <Tab.Screen name="Statistics" component={StatisticsScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
      </NavigationContainer>
    </View>
  );
}



