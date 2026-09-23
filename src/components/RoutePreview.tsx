import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import type { WalkGpsSession } from '../types';
import { colors } from '../theme/colors';
import { RtlText } from './RtlText';

interface RoutePreviewProps {
  session: WalkGpsSession | null;
  large?: boolean;
}

/** Lightweight in-app route drawing. It deliberately has no map provider dependency. */
export function RoutePreview({ session, large = false }: RoutePreviewProps) {
  const points = session?.routePoints ?? [];
  const dimensions = large ? { width: 320, height: 210 } : { width: 92, height: 72 };
  const path = useMemo(() => {
    if (points.length < 2) return '';
    const minLat = Math.min(...points.map((p) => p.latitude));
    const maxLat = Math.max(...points.map((p) => p.latitude));
    const minLon = Math.min(...points.map((p) => p.longitude));
    const maxLon = Math.max(...points.map((p) => p.longitude));
    const latSpan = Math.max(maxLat - minLat, 0.00001);
    const lonSpan = Math.max(maxLon - minLon, 0.00001);
    return points.map((p) => `${8 + ((p.longitude - minLon) / lonSpan) * (dimensions.width - 16)},${8 + (1 - (p.latitude - minLat) / latSpan) * (dimensions.height - 16)}`).join(' ');
  }, [dimensions.height, dimensions.width, points]);

  if (points.length < 2) return null;
  const first = path.split(' ')[0].split(',');
  const last = path.split(' ').at(-1)?.split(',') ?? first;

  return (
    <View style={[styles.wrapper, large && styles.largeWrapper]} accessibilityLabel="תצוגת מסלול הטיול">
      <Svg width={dimensions.width} height={dimensions.height} viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}>
        <Polyline points={path} fill="none" stroke={colors.primaryDark} strokeWidth={large ? 5 : 3} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={Number(first[0])} cy={Number(first[1])} r={large ? 7 : 4} fill={colors.success} />
        <Circle cx={Number(last[0])} cy={Number(last[1])} r={large ? 7 : 4} fill={colors.statusOverdue} />
      </Svg>
      {large ? <RtlText style={styles.legend}>● התחלה　● סיום</RtlText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: 92, height: 72, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.statusCurrentBg, alignItems: 'center', justifyContent: 'center' },
  largeWrapper: { width: '100%', height: 240, borderRadius: 18, backgroundColor: colors.surfaceMuted },
  legend: { position: 'absolute', bottom: 8, fontSize: 12, color: colors.textSecondary },
});
