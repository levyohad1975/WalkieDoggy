import React, { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import type { WalkGpsSession } from '../types';
import { accumulateDistance, createGpsAccumulator, formatDistanceMeters } from '../logic/gpsDistance';
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
  // Display-only filtering: never mutate persisted routePoints or the recorded distance.
  // Re-apply the shared walking-speed and accuracy gates to legacy sessions
  // that may have been captured before live GPS jump filtering existed.
  const rawPoints = session?.routePoints ?? [];
  const points = useMemo(() => rawPoints.reduce(
    (acc, point) => accumulateDistance(acc, point),
    createGpsAccumulator(),
  ).routePoints, [rawPoints]);
  const reconstruction = session?.reconstruction;
  const reconstructedPoints = reconstruction?.routePoints ?? [];
  const [mapOpen, setMapOpen] = useState(false);
  const mapPoints = points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180).map(p => [p.latitude, p.longitude]);
  const estimatedMapPoints = [...reconstructedPoints, ...(points.length ? [points[0]] : [])].filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180).map(p => [p.latitude, p.longitude]);
  const webMap = Platform.OS === 'web' && (mapPoints.length >= 1 || estimatedMapPoints.length >= 1);
  const dimensions = large ? { width: 320, height: 210 } : compact ? { width: 72, height: 48 } : { width: 92, height: 72 };
  const allPoints = [...points, ...reconstructedPoints];
  const hasEnoughSamples = points.length >= 2 || reconstructedPoints.length >= 2;
  const projectRoute = (route: typeof points) => {
    if (!route.length || !allPoints.length) return '';
    const minLat = Math.min(...allPoints.map((p) => p.latitude));
    const maxLat = Math.max(...allPoints.map((p) => p.latitude));
    const minLon = Math.min(...allPoints.map((p) => p.longitude));
    const maxLon = Math.max(...allPoints.map((p) => p.longitude));
    const midLat = (minLat + maxLat) / 2;
    const lonScale = Math.max(Math.cos(midLat * Math.PI / 180), 0.01);
    const latSpan = Math.max(maxLat - minLat, 0.00001);
    const lonSpan = Math.max((maxLon - minLon) * lonScale, 0.00001);
    const scale = Math.min((dimensions.width - 16) / lonSpan, (dimensions.height - 16) / latSpan);
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    return route.map((p) => `${dimensions.width / 2 + (p.longitude - centerLon) * lonScale * scale},${dimensions.height / 2 - (p.latitude - centerLat) * scale}`).join(' ');
  };
  const path = projectRoute(points);
  const estimatedPath = projectRoute([...reconstructedPoints, ...(points.length ? [points[0]] : [])]);
  const measuredDurationSeconds = points.length > 1 ? Math.max(0, (points[points.length - 1].timestamp - points[0].timestamp) / 1000) : 0;
  const estimatedTotalMinutes = Math.round(((reconstruction?.durationSeconds ?? 0) + measuredDurationSeconds) / 60);
  const measuredDistanceMeters = session?.distanceMeters ?? 0;
  const estimatedTotalDistanceMeters = measuredDistanceMeters + (reconstruction?.distanceMeters ?? 0);

  if (points.length < 2 && reconstructedPoints.length < 2 && !live) return null;
  if (live && mapPoints.length === 0 && estimatedMapPoints.length === 0) {
    return <View style={[styles.wrapper, styles.liveWrapper]} accessibilityLabel="מפת הטיול ממתינה למיקום ראשון"><RtlText style={styles.incomplete}>📍 ממתין למיקום GPS ראשון…</RtlText></View>;
  }
  if (webMap) {
    const renderMap = (expanded: boolean) => React.createElement('iframe', {
      title: 'מפת רחובות ומסלול GPS',
      srcDoc: buildMapHtml(mapPoints, estimatedMapPoints, expanded, live),
      sandbox: 'allow-scripts',
      style: { display: 'block', border: 0, width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', overflow: 'hidden', borderRadius: expanded ? 12 : 9, pointerEvents: expanded ? 'auto' : 'none' },
    });
    return (
      <>
        <Pressable onPress={() => setMapOpen(true)} accessibilityRole="button" accessibilityLabel="פתח מפת רחובות עם מסלול הטיול" style={[styles.wrapper, compact && !large && styles.compactWrapper, large && styles.largeWrapper, live && styles.liveWrapper]}>
          {renderMap(false)}
        </Pressable>
        {reconstruction ? <View style={styles.estimateSummary}>
          <RtlText style={styles.summaryText}>{`מדוד ב-GPS: ${formatDistanceMeters(session?.distanceMeters ?? 0)} · ${Math.round(measuredDurationSeconds / 60)} דק׳`}</RtlText>
          <RtlText style={styles.summaryText}>{`משוער לפני ההפעלה: ${formatDistanceMeters(reconstruction.distanceMeters)} · כ־${Math.round(reconstruction.durationSeconds / 60)} דק׳`}</RtlText>
          <RtlText style={styles.summaryText}>{`סה״כ משוער: ${formatDistanceMeters(estimatedTotalDistanceMeters)} · כ־${estimatedTotalMinutes} דק׳`}{reconstruction.confidence === 'low' ? ' · ביטחון נמוך' : ''}</RtlText>
          {reconstruction.confidence === 'low' ? <RtlText style={styles.lowConfidence}>השחזור מבוסס על מסלול דומה, ברמת ביטחון נמוכה.</RtlText> : null}
        </View> : null}
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
  const first = (path || estimatedPath).split(' ')[0].split(',');
  const last = (path || estimatedPath).split(' ').at(-1)?.split(',') ?? first;

  return (
    <View style={[styles.wrapper, large && styles.largeWrapper]} accessibilityLabel="תצוגת מסלול הטיול">
      <Svg width={dimensions.width} height={dimensions.height} viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}>
        <Polyline points={path} fill="none" stroke={colors.primaryDark} strokeWidth={large ? 5 : 3} strokeLinecap="round" strokeLinejoin="round" />
        {estimatedPath ? <Polyline points={estimatedPath} fill="none" stroke={colors.statusOverdue} strokeWidth={large ? 4 : 2.5} strokeDasharray={large ? '9 7' : '5 4'} strokeLinecap="round" strokeLinejoin="round" /> : null}
        <Circle cx={Number(first[0])} cy={Number(first[1])} r={large ? 7 : 4} fill={colors.success} />
        <Circle cx={Number(last[0])} cy={Number(last[1])} r={large ? 7 : 4} fill={colors.statusOverdue} />
      </Svg>
      {reconstruction ? <View style={styles.legendWrap}>
        <RtlText style={styles.legend}>{`מקווקו, משוער: ${formatDistanceMeters(reconstruction.distanceMeters)} · כ־${Math.round(reconstruction.durationSeconds / 60)} דק׳`}</RtlText>
        <RtlText style={styles.legend}>{`GPS מדוד: ${formatDistanceMeters(measuredDistanceMeters)} · ${Math.round(measuredDurationSeconds / 60)} דק׳`}</RtlText>
        <RtlText style={styles.legend}>{`סה״כ משוער: ${formatDistanceMeters(estimatedTotalDistanceMeters)} · כ־${estimatedTotalMinutes} דק׳`}</RtlText>
        {reconstruction.confidence === 'low' ? <RtlText style={styles.lowConfidence}>השחזור מבוסס על מסלול דומה, ברמת ביטחון נמוכה.</RtlText> : null}
      </View> : large ? <RtlText style={styles.legend}>● התחלה　● סיום</RtlText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: 92, height: 72, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.statusCurrentBg, alignItems: 'center', justifyContent: 'center' },
  compactWrapper: { width: 72, height: 48, borderRadius: 9 },
  liveWrapper: { width: '100%', height: 180, borderRadius: 12 },
  mapBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 16 },
  mapCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 12, gap: 8 },
  closeMap: { padding: 12, alignSelf: 'flex-end' },
  expandedMap: { height: 430, width: '100%' },
  mapAttribution: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  largeWrapper: { width: '100%', height: 240, borderRadius: 18, backgroundColor: colors.surfaceMuted },
  incomplete: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 4 },
  legend: { position: 'absolute', bottom: 8, fontSize: 12, color: colors.textSecondary },
  legendWrap: { position: 'absolute', bottom: 3, left: 4, right: 4, backgroundColor: '#FFFFFFE8', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  lowConfidence: { fontSize: 10, color: colors.textSecondary, textAlign: 'right' },
  estimateSummary: { width: '100%', paddingHorizontal: 4, gap: 2 },
  summaryText: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
});

/** Free vector basemap via OpenFreeMap and MapLibre. GPS coordinates never leave the browser except as ordinary map rendering data. */
function buildMapHtml(points: number[][], estimatedPoints: number[][], expanded: boolean, live: boolean): string {
  const coords = JSON.stringify(points);
  const estimateCoords = JSON.stringify(estimatedPoints);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"><style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden} .maplibregl-control-container{font:10px system-ui} .maplibregl-ctrl-attrib{font-size:10px!important} .maplibregl-ctrl-bottom-right{max-width:100%}</style></head><body><div id="map"></div>${expanded && !live ? '<button id="replay" style="position:absolute;z-index:5;top:12px;left:12px;border:0;border-radius:20px;padding:10px 16px;background:#fff;color:#183e48;font:600 14px system-ui">▶ נגן מסלול</button>' : ''}<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script><script>
  const points = ${coords};
  const estimatedPoints = ${estimateCoords};
  const allCoordinates = [...estimatedPoints,...points];
  const initial = points[0] || estimatedPoints[0];
  // MapLibre's RTL plugin performs Unicode bidi shaping for Hebrew labels on vector tiles.
  // Do not reverse the text or mirror the map: both corrupt street names and route geometry.
  if(maplibregl.setRTLTextPlugin){maplibregl.setRTLTextPlugin('https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js',true).catch(()=>{});}
  const map = new maplibregl.Map({
    container:'map',style:'https://tiles.openfreemap.org/styles/liberty',
    center:[initial[1],initial[0]],zoom:16,
    interactive:${expanded ? 'true' : 'false'},attributionControl:${expanded ? 'true' : 'false'}
  });
  map.on('load',()=>{
    const coordinates=points.map(p=>[p[1],p[0]]);
    if(coordinates.length>1){
      map.addSource('walk-route',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates}}});
      map.addLayer({id:'walk-route-outline',type:'line',source:'walk-route',paint:{'line-color':'#ffffff','line-width':8,'line-opacity':0.95},layout:{'line-join':'round','line-cap':'round'}});
      map.addLayer({id:'walk-route-line',type:'line',source:'walk-route',paint:{'line-color':'#12A5AB','line-width':4.5},layout:{'line-join':'round','line-cap':'round'}});
    }
    const estimated=estimatedPoints.map(p=>[p[1],p[0]]);
    if(estimated.length>1){
      map.addSource('walk-route-estimated',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:estimated}}});
      map.addLayer({id:'walk-route-estimated-line',type:'line',source:'walk-route-estimated',paint:{'line-color':'#D9705C','line-width':4,'line-dasharray':[2,2]},layout:{'line-join':'round','line-cap':'round'}});
    }
    if(allCoordinates.length){
      const bounds=allCoordinates.map(p=>[p[1],p[0]]).reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds([allCoordinates[0][1],allCoordinates[0][0]],[allCoordinates[0][1],allCoordinates[0][0]]));
      map.fitBounds(bounds,{padding:${expanded ? '56' : '18'},maxZoom:17,duration:0});
    }
    const marker=(coord,color,label)=>new maplibregl.Marker({color,scale:0.75}).setLngLat(coord).setPopup(new maplibregl.Popup({offset:16}).setText(label)).addTo(map);
    if(${expanded ? 'true' : 'false'} && coordinates.length)marker(coordinates[0],'#138A52','תחילת מדידת GPS');
    if(${expanded ? 'true' : 'false'} && coordinates.length>1)marker(coordinates[coordinates.length-1],'#2684D9','סיום / מיקום אחרון');
    if(${live ? 'true' : 'false'} && coordinates.length){
      const current=coordinates[coordinates.length-1];
      new maplibregl.Marker({color:'#1976D2',scale:0.8}).setLngLat(current).addTo(map);
      if(${expanded ? 'true' : 'false'})map.easeTo({center:current,zoom:17,duration:0});
    }
    const replay=document.getElementById('replay');
    if(replay && coordinates.length>1){
      let timer=null,index=0;
      const progress=new maplibregl.Marker({color:'#1976D2',scale:0.9}).setLngLat(coordinates[0]);
      replay.addEventListener('click',()=>{
        if(timer){clearInterval(timer);timer=null;replay.textContent='▶ המשך מסלול';return;}
        if(index>=coordinates.length-1)index=0;
        progress.addTo(map);replay.textContent='Ⅱ השהה';
        timer=setInterval(()=>{
          index=Math.min(index+1,coordinates.length-1);
          progress.setLngLat(coordinates[index]);
          map.easeTo({center:coordinates[index],duration:450});
          if(index===coordinates.length-1){clearInterval(timer);timer=null;replay.textContent='↻ הפעל שוב';}
        },500);
      });
    }else if(replay){replay.style.display='none';}
    map.resize();
  });
  </script></body></html>`;
}
