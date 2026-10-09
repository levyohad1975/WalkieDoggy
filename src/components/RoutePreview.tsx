import React, { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import type { WalkGpsSession } from '../types';
import { colors } from '../theme/colors';
import { RtlText } from './RtlText';

interface RoutePreviewProps {
  session: WalkGpsSession | null;
  large?: boolean;
  compact?: boolean;
}

/** Lightweight in-app route drawing. It deliberately has no map provider dependency. */
export function RoutePreview({ session, large = false, compact = false }: RoutePreviewProps) {
  const points = session?.routePoints ?? [];
  const [mapOpen, setMapOpen] = useState(false);
  const mapPoints = points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180).map(p => [p.latitude, p.longitude]);
  const webMap = Platform.OS === 'web' && mapPoints.length >= 2;
  const dimensions = large ? { width: 320, height: 210 } : compact ? { width: 72, height: 48 } : { width: 92, height: 72 };
  const hasEnoughSamples = points.length >= 3;
  const path = useMemo(() => {
    if (!hasEnoughSamples) return '';
    const minLat = Math.min(...points.map((p) => p.latitude));
    const maxLat = Math.max(...points.map((p) => p.latitude));
    const minLon = Math.min(...points.map((p) => p.longitude));
    const maxLon = Math.max(...points.map((p) => p.longitude));
    const midLat = (minLat + maxLat) / 2;
    const lonScale = Math.max(Math.cos(midLat * Math.PI / 180), 0.01);
    const latSpan = Math.max(maxLat - minLat, 0.00001);
    const lonSpan = Math.max((maxLon - minLon) * lonScale, 0.00001);
    const scale = Math.min((dimensions.width - 16) / lonSpan, (dimensions.height - 16) / latSpan);
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    return points.map((p) => `${dimensions.width / 2 + (p.longitude - centerLon) * lonScale * scale},${dimensions.height / 2 - (p.latitude - centerLat) * scale}`).join(' ');
  }, [dimensions.height, dimensions.width, points, hasEnoughSamples]);

  if (points.length < 2) return null;
  if (webMap) {
    const renderMap = (expanded: boolean) => React.createElement('iframe', {
      title: 'מפת רחובות ומסלול GPS',
      srcDoc: buildMapHtml(mapPoints),
      sandbox: 'allow-scripts',
      style: { border: 0, width: '100%', height: '100%', borderRadius: expanded ? 12 : 9 },
    });
    return (
      <>
        <Pressable onPress={() => setMapOpen(true)} accessibilityRole="button" accessibilityLabel="פתח מפת רחובות עם מסלול הטיול" style={[styles.wrapper, compact && !large && styles.compactWrapper, large && styles.largeWrapper]}>
          {renderMap(false)}
        </Pressable>
        <Modal visible={mapOpen} transparent animationType="slide" onRequestClose={() => setMapOpen(false)}>
          <View style={styles.mapBackdrop}>
            <View style={styles.mapCard}>
              <Pressable onPress={() => setMapOpen(false)} accessibilityRole="button" accessibilityLabel="סגור מפה" style={styles.closeMap}><RtlText>✕ סגור מפה</RtlText></Pressable>
              <View style={styles.expandedMap}>{renderMap(true)}</View>
              <RtlText style={styles.mapAttribution}>© OpenStreetMap contributors</RtlText>
            </View>
          </View>
        </Modal>
      </>
    );
  }
  if (!hasEnoughSamples) {
    return (
      <View style={[styles.wrapper, compact && !large && styles.compactWrapper, large && styles.largeWrapper]} accessibilityLabel="מסלול GPS חלקי: אין מספיק נקודות להצגת המסלול">
        <RtlText style={styles.incomplete}>{large ? 'אין מספיק נקודות GPS להצגת המסלול' : 'GPS חלקי'}</RtlText>
      </View>
    );
  }
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
  compactWrapper: { width: 72, height: 48, borderRadius: 9 },
  mapBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 16 },
  mapCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 12, gap: 8 },
  closeMap: { padding: 12, alignSelf: 'flex-end' },
  expandedMap: { height: 430, width: '100%' },
  mapAttribution: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  largeWrapper: { width: '100%', height: 240, borderRadius: 18, backgroundColor: colors.surfaceMuted },
  incomplete: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 4 },
  legend: { position: 'absolute', bottom: 8, fontSize: 12, color: colors.textSecondary },
});

/** Leaflet and OSM standard tiles are free services, subject to their usage policies. */
function buildMapHtml(points: number[][]): string {
  const coords = JSON.stringify(points);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
  const points = ${coords};
  const map = L.map('map',{zoomControl:false,scrollWheelZoom:false});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  const route = L.polyline(points,{color:'#12A5AB',weight:4}).addTo(map);
  L.circleMarker(points[0],{radius:6,color:'#138A52'}).addTo(map);
  L.circleMarker(points[points.length-1],{radius:6,color:'#D74747'}).addTo(map);
  map.fitBounds(route.getBounds().pad(0.35),{maxZoom:18});
  </script></body></html>`;
}
