import React, { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';
import { HomeScreen } from '../screens/HomeScreen';
import { ScheduleScreen } from '../screens/ScheduleScreen';
import { FamilyScreen } from '../screens/FamilyScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { StatisticsScreen } from '../screens/StatisticsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ImpersonationBanner } from '../components/ImpersonationBanner';
import { SystemObserverBanner } from '../components/SystemObserverBanner';
import { colors } from '../theme/colors';
import { layout, nativeDirection, spacing } from '../theme/tokens';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useRequestsStore } from '../store/requestsStore';
import { subscribeToFamilyChanges } from '../lib/realtime';
import { DEMO_FAMILY } from '../data/demoData';
import { canAccessHistoryScreen, canAccessStatisticsScreen, canAccessSettingsScreen } from '../logic/permissions';

export type RootTabParamList = {
  Home: undefined;
  Schedule: undefined;
  Family: undefined;
  History: undefined;
  Statistics: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

function TabIcon({ name, color }: { name: keyof RootTabParamList; color: string }) {
  const common = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const icon = (() => {
    switch (name) {
      case 'Home':
        return <><Path d="M3 10.5 12 3l9 7.5" {...common} /><Path d="M5 9.5V21h14V9.5M9 21v-7h6v7" {...common} /></>;
      case 'Schedule':
        return <><Rect x="3" y="5" width="18" height="16" rx="2" {...common} fill="none" /><Line x1="7" y1="3" x2="7" y2="7" {...common} /><Line x1="17" y1="3" x2="17" y2="7" {...common} /><Line x1="3" y1="10" x2="21" y2="10" {...common} /></>;
      case 'Family':
        return <><Circle cx="9" cy="8" r="3" {...common} fill="none" /><Circle cx="17" cy="9" r="2.5" {...common} fill="none" /><Path d="M3.5 20c.4-4 2.3-6 5.5-6s5.1 2 5.5 6M14 15c3.7-.8 6 1 6.5 4.5" {...common} /></>;
      case 'History':
        return <><Path d="M4 5.5C6.5 4.5 9 4.7 12 6v15c-3-1.3-5.5-1.5-8-.5zM20 5.5c-2.5-1-5-.8-8 .5v15c3-1.3 5.5-1.5 8-.5z" {...common} fill="none" /></>;
      case 'Statistics':
        return <><Polyline points="4,18 9,12 13,15 20,7" {...common} fill="none" /><Line x1="4" y1="21" x2="20" y2="21" {...common} /></>;
      case 'Settings':
        return <><Circle cx="12" cy="12" r="3" {...common} fill="none" /><Path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.09 14H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.09V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.91 10H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" {...common} fill="none" /></>;
    }
  })();
  return <Svg width={layout.iconSize} height={layout.iconSize} viewBox="0 0 24 24" accessibilityElementsHidden>{icon}</Svg>;
}

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
  'Family',
  'Home',
  'Schedule',
  'History',
];

// Item 8 (nav centering): Home must sit at the exact geometric center of the
// bar regardless of how many of the OTHER destinations are currently visible
// (History/Statistics/Settings are each permission-gated and can come and go
// independently — see canSeeHistoryTab/canSeeStatisticsTab/canSeeSettingsTab
// below). Splitting the non-Home destinations into two independent flex
// groups (everything physically before Home, everything physically after)
// and absolutely-positioning Home at left: 50% of the whole bar decouples
// its position from either group's item count entirely — it is centered on
// the bar itself, never on "whatever's left after subtracting N buttons".
// This slot width only reserves layout space in the two flex groups (so
// their buttons never render underneath the centered Home circle); it does
// not constrain Home's own tap target, which stays exactly as large as
// before (see HOME_BUTTON_SIZE below).
const HOME_SLOT_WIDTH = 76;
const HOME_BUTTON_SIZE = 50;

/**
 * A physically deterministic tab bar. React Navigation/iOS can re-evaluate
 * RTL mirroring when Dynamic Type changes at runtime; rendering the buttons
 * ourselves in an explicitly-LTR row prevents that transient flip while the
 * Hebrew labels themselves remain RTL text.
 */
function FixedPhysicalTabBar({ state, descriptors, navigation, canSeeHistoryTab, canSeeStatisticsTab, canSeeSettingsTab }: BottomTabBarProps & { canSeeHistoryTab: boolean; canSeeStatisticsTab: boolean; canSeeSettingsTab: boolean }) {
  const insets = useSafeAreaInsets();
  const routeByName = Object.fromEntries(state.routes.map((route) => [route.name, route]));
  const isVisible = (name: keyof RootTabParamList) => {
    if (!routeByName[name]) return false;
    if (name === 'History') return canSeeHistoryTab;
    if (name === 'Statistics') return canSeeStatisticsTab;
    if (name === 'Settings') return canSeeSettingsTab;
    return true;
  };

  const renderTabButton = (name: keyof RootTabParamList) => {
    const route = routeByName[name];
    if (!route) return null;
    const focused = state.routes[state.index]?.key === route.key;
    const options = descriptors[route.key]?.options;
    const tint = focused ? colors.primary : colors.textSecondary;
    return (
      <Pressable
        key={route.key}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            // Target the tab navigator by route key. With conditional
            // History/Statistics routes, navigating only by name could
            // be resolved against stale navigator state and fall back
            // to the initial Home route after permission refreshes.
            navigation.navigate({ key: route.key, name: route.name } as never);
          }
        }}
        onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        accessibilityLabel={options?.tabBarAccessibilityLabel ?? TAB_LABEL[name]}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1 }}
      >
        <TabIcon name={name} color={tint} />
        <RtlText allowFontScaling={false} numberOfLines={1} style={{ fontSize: 11, fontWeight: '600', color: tint, textAlign: 'center', writingDirection: 'rtl' }}>{TAB_LABEL[name]}</RtlText>
      </Pressable>
    );
  };

  const homeIndex = PHYSICAL_TAB_ORDER.indexOf('Home');
  const leftButtons = PHYSICAL_TAB_ORDER.slice(0, homeIndex).filter(isVisible).map(renderTabButton);
  const rightButtons = PHYSICAL_TAB_ORDER.slice(homeIndex + 1).filter(isVisible).map(renderTabButton);

  const homeRoute = routeByName.Home;
  const homeFocused = homeRoute ? state.routes[state.index]?.key === homeRoute.key : false;
  const homeOptions = homeRoute ? descriptors[homeRoute.key]?.options : undefined;

  return (
    <View style={{ height: layout.rowHeight + insets.bottom, paddingBottom: Math.max(spacing.sm, insets.bottom), paddingTop: 6, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: Platform.OS === 'web' ? 1000 : undefined,
          alignSelf: 'center',
          flexDirection: 'row',
          position: 'relative',
          ...nativeDirection('ltr'),
        }}
      >
        <View style={{ flex: 1, flexDirection: 'row' }}>{leftButtons}</View>
        {/* Reserves the centered Home button's own footprint so the two side
            groups never render underneath it. */}
        <View style={{ width: HOME_SLOT_WIDTH }} />
        <View style={{ flex: 1, flexDirection: 'row' }}>{rightButtons}</View>

        {homeRoute ? (
          <Pressable
            key={homeRoute.key}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: homeRoute.key, canPreventDefault: true });
              if (!homeFocused && !event.defaultPrevented) {
                navigation.navigate({ key: homeRoute.key, name: homeRoute.name } as never);
              }
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: homeRoute.key })}
            accessibilityRole="button"
            accessibilityState={homeFocused ? { selected: true } : {}}
            accessibilityLabel={homeOptions?.tabBarAccessibilityLabel ?? TAB_LABEL.Home}
            style={{
              position: 'absolute',
              left: '50%',
              marginLeft: -(HOME_SLOT_WIDTH / 2),
              top: 0,
              bottom: 0,
              width: HOME_SLOT_WIDTH,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              transform: [{ translateY: -10 }],
            }}
          >
            <View style={{ width: HOME_BUTTON_SIZE, height: HOME_BUTTON_SIZE, borderRadius: HOME_BUTTON_SIZE / 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.surface }}>
              <TabIcon name="Home" color={colors.textInverse} />
            </View>
            <RtlText allowFontScaling={false} numberOfLines={1} style={{ fontSize: 11, fontWeight: '800', color: colors.primary, textAlign: 'center', writingDirection: 'rtl' }}>{TAB_LABEL.Home}</RtlText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}


export function RootNavigator() {
  const [activeTabName, setActiveTabName] = useState<keyof RootTabParamList>('Home');
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
  const effectiveFamilyRole = useEffectiveFamilyRole();
  const canSeeSettingsTab = effectiveFamilyRole === 'admin' ||
    canAccessSettingsScreen(effectiveUserId, permissionOverrides, permissionOverridesStatus);
  // Gates the wrapping SafeAreaView itself (not just the banner's own
  // internal null-check) — otherwise an empty top-inset-padded View would
  // sit above every screen at all times, silently pushing everything down
  // even while nobody is being impersonated.
  const impersonatingUserId = useAuthStore((s) => s.impersonatingUserId);
  const systemObserverActive = useAuthStore((s) => s.systemObserverActive);
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
      {systemObserverActive ? (
        <SafeAreaView edges={['top']} style={{ backgroundColor: colors.primaryDark }}>
          <SystemObserverBanner />
        </SafeAreaView>
      ) : null}
      {impersonatingUserId ? (
        <SafeAreaView edges={['top']} style={{ backgroundColor: colors.primaryDark }}>
          <ImpersonationBanner />
        </SafeAreaView>
      ) : null}
      <NavigationContainer direction="rtl" onStateChange={(state) => { const name = state?.routes[state.index ?? 0]?.name as keyof RootTabParamList | undefined; if (name) setActiveTabName(name); }}>
      <Tab.Navigator
        initialRouteName="Home"
        tabBar={(props) => <FixedPhysicalTabBar {...props} canSeeHistoryTab={canSeeHistoryTab} canSeeStatisticsTab={canSeeStatisticsTab} canSeeSettingsTab={canSeeSettingsTab} />}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: {
            height: layout.rowHeight + insets.bottom,
            paddingBottom: Math.max(spacing.sm, insets.bottom),
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarAllowFontScaling: false,
          tabBarIcon: ({ color }) => <TabIcon name={route.name as keyof RootTabParamList} color={color} />,
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
        {(canSeeHistoryTab || activeTabName === 'History') ? <Tab.Screen name="History" component={HistoryScreen} /> : null}
        {(canSeeStatisticsTab || activeTabName === 'Statistics') ? <Tab.Screen name="Statistics" component={StatisticsScreen} /> : null}
        {(canSeeSettingsTab || activeTabName === 'Settings') ? <Tab.Screen name="Settings" component={SettingsScreen} /> : null}
      </Tab.Navigator>
      </NavigationContainer>
    </View>
  );
}



