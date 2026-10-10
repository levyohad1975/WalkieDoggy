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
  live?: boolean;
}

/** Lightweight in-app route drawing. It deliberately has no map provider dependency. */
export function RoutePreview({ session, large = false, compact = false, live = false }: RoutePreviewProps) {
  const points = session?.routePoints ?? [];
  const [mapOpen, setMapOpen] = useState(false);
  const mapPoints = points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180).map(p => [p.latitude, p.longitude]);
  const webMap = Platform.OS === 'web' && mapPoints.length >= 1;
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

  if (points.length < 2 && !live) return null;
  if (live && mapPoints.length === 0) {
    return <View style={[styles.wrapper, styles.liveWrapper]} accessibilityLabel="מפת הטיול ממתינה למיקום ראשון"><RtlText style={styles.incomplete}>📍 ממתין למיקום GPS ראשון…</RtlText></View>;
  }
  if (webMap) {
    const renderMap = (expanded: boolean) => React.createElement('iframe', {
      title: 'מפת רחובות ומסלול GPS',
      srcDoc: buildMapHtml(mapPoints, expanded),
      sandbox: 'allow-scripts',
      style: { display: 'block', border: 0, width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', overflow: 'hidden', borderRadius: expanded ? 12 : 9, pointerEvents: expanded ? 'auto' : 'none' },
    });
    return (
      <>
        <Pressable onPress={() => setMapOpen(true)} accessibilityRole="button" accessibilityLabel="פתח מפת רחובות עם מסלול הטיול" style={[styles.wrapper, compact && !large && styles.compactWrapper, large && styles.largeWrapper, live && styles.liveWrapper]}>
          {renderMap(false)}
        </Pressable>
        <Modal visible={mapOpen} transparent animationType="slide" onRequestClose={() => setMapOpen(false)}>
          <View style={styles.mapBackdrop}>
            <View style={styles.mapCard}>
              <Pressable onPress={() => setMapOpen(false)} accessibilityRole="button" accessibilityLabel="סגור מפה" style={styles.closeMap}><RtlText>✕ סגור מפה</RtlText></Pressable>
              <View style={styles.expandedMap}>{renderMap(true)}</View>
              <RtlText style={styles.mapAttribution}>© OpenStreetMap contributors · OpenFreeMap</RtlText>
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
  liveWrapper: { width: '100%', height: 112, borderRadius: 12 },
  mapBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 16 },
  mapCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 12, gap: 8 },
  closeMap: { padding: 12, alignSelf: 'flex-end' },
  expandedMap: { height: 430, width: '100%' },
  mapAttribution: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  largeWrapper: { width: '100%', height: 240, borderRadius: 18, backgroundColor: colors.surfaceMuted },
  incomplete: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 4 },
  legend: { position: 'absolute', bottom: 8, fontSize: 12, color: colors.textSecondary },
});

/** Free vector basemap via OpenFreeMap and MapLibre. GPS coordinates never leave the browser except as ordinary map rendering data. */
function buildMapHtml(points: number[][], expanded: boolean): string {
  const coords = JSON.stringify(points);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"><style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden} .maplibregl-control-container{font:10px system-ui} .maplibregl-ctrl-attrib{font-size:10px!important} .maplibregl-ctrl-bottom-right{max-width:100%}</style></head><body><div id="map"></div><script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script><script>
  const points = ${coords};
  const map = new maplibregl.Map({
    container:'map',style:'https://tiles.openfreemap.org/styles/positron',
    center:[points[0][1],points[0][0]],zoom:16,
    interactive:${expanded ? 'true' : 'false'},attributionControl:true
  });
  map.on('load',()=>{
    const coordinates=points.map(p=>[p[1],p[0]]);
    if(coordinates.length>1){
      map.addSource('walk-route',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates}}});
      map.addLayer({id:'walk-route-outline',type:'line',source:'walk-route',paint:{'line-color':'#ffffff','line-width':7,'line-opacity':0.95},layout:{'line-join':'round','line-cap':'round'}});
      map.addLayer({id:'walk-route-line',type:'line',source:'walk-route',paint:{'line-color':'#12A5AB','line-width':3.5},layout:{'line-join':'round','line-cap':'round'}});
      const bounds=coordinates.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(coordinates[0],coordinates[0]));
      map.fitBounds(bounds,{padding:${expanded ? '48' : '16'},maxZoom:17,duration:0});
    }
    const marker=(coord,color,label)=>new maplibregl.Marker({color,scale:0.75}).setLngLat(coord).setPopup(new maplibregl.Popup({offset:16}).setText(label)).addTo(map);
    marker(coordinates[0],'#138A52','תחילת הטיול');
    if(coordinates.length>1)marker(coordinates[coordinates.length-1],'#2684D9','סיום / מיקום אחרון');
    map.resize();
  });
  </script></body></html>`;
}
