import React, { useMemo, useState } from 'react';
import { Dimensions, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import type { WalkGpsSession } from '../types';
import { accumulateDistance, createGpsAccumulator, formatDistanceMeters } from '../logic/gpsDistance';
import { HOME_LEAD_MIN_METERS, homeLeadForDisplay, homeLegsSummary, homeTailForDisplay, routeForDisplay } from '../logic/routeDisplay';
import { haversineDistanceMeters } from '../logic/gpsDistance';
import { useFamilyStore } from '../store/familyStore';
import { colors } from '../theme/colors';
import { RtlText } from './RtlText';

interface RoutePreviewProps {
  session: WalkGpsSession | null;
  large?: boolean;
  compact?: boolean;
  live?: boolean;
  /** Shown in the expanded map's summary line, e.g. "אבא · יום ב׳ 02.11". */
  caption?: string;
}

/** Lightweight in-app route drawing. It deliberately has no map provider dependency. */
export function RoutePreview({ session, large = false, compact = false, live = false, caption }: RoutePreviewProps) {
  // Display-only filtering: never mutate persisted routePoints or the recorded distance.
  // Re-apply the shared walking-speed and accuracy gates to legacy sessions
  // that may have been captured before live GPS jump filtering existed.
  const rawPoints = session?.routePoints ?? [];
  const points = useMemo(() => rawPoints.reduce(
    (acc, point) => accumulateDistance(acc, point),
    createGpsAccumulator(),
  ).routePoints, [rawPoints]);
  // Owner request 2026-11-02: draw the walk without GPS wander (zigzags,
  // straight lines across the park). Drawing only; distance is unchanged.
  const drawnPoints = useMemo(() => (live ? points : routeForDisplay(points)), [points, live]);
  const reconstruction = session?.reconstruction;
  const home = useFamilyStore((s) => (session?.dogId ? s.dogs.find((d) => d.id === session.dogId)?.homeLocation : undefined));
  // No saved reconstruction but the walk began away from home: show the
  // missing lead from home as an estimate (drawing only).
  const homeLead = useMemo(
    () => (reconstruction ? null : homeLeadForDisplay(home, drawnPoints[0])),
    [reconstruction, home, drawnPoints],
  );
  const reconstructedPoints = reconstruction?.routePoints ?? homeLead?.routePoints ?? [];
  // ...and every walk also ends at home: complete a measurement that stopped away from it.
  const homeTail = useMemo(
    () => (live || !drawnPoints.length ? null : homeTailForDisplay(home, drawnPoints[drawnPoints.length - 1])),
    [live, home, drawnPoints],
  );
  const homeLegsLine = homeLegsSummary(homeLead?.distanceMeters ?? null, homeTail?.distanceMeters ?? null, formatDistanceMeters);
  const homeLegsMeters = (homeLead?.distanceMeters ?? 0) + (homeTail?.distanceMeters ?? 0);
  const tailMapPoints = (homeTail?.routePoints ?? []).map((p) => [p.latitude, p.longitude]);
  // One shared "home" pin; the 🏁 is dropped when the walk ended next to it.
  const lastDrawn = drawnPoints[drawnPoints.length - 1];
  const homePin = (homeLead || homeTail) && home ? [home.latitude, home.longitude] : null;
  const endNearHome = Boolean(homePin && lastDrawn && !homeTail
    && haversineDistanceMeters({ latitude: home!.latitude, longitude: home!.longitude, timestamp: 0 }, lastDrawn) < HOME_LEAD_MIN_METERS);
  const [mapOpen, setMapOpen] = useState(false);
  const measuredMapPoints = drawnPoints.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180).map(p => [p.latitude, p.longitude]);
  // A walk that began or ended next to home is drawn reaching the 🏠 pin
  // (a gap under 60 m is GPS noise, not a missing leg).
  const firstDrawn = drawnPoints[0];
  const startNearHome = Boolean(homePin && firstDrawn && !homeLead && !reconstruction
    && haversineDistanceMeters({ latitude: home!.latitude, longitude: home!.longitude, timestamp: 0 }, firstDrawn) < HOME_LEAD_MIN_METERS);
  const mapPoints = live || !homePin ? measuredMapPoints : [
    ...(startNearHome ? [homePin] : []),
    ...measuredMapPoints,
    ...(endNearHome ? [homePin] : []),
  ];
  const estimatedMapPoints = [...reconstructedPoints, ...(drawnPoints.length ? [drawnPoints[0]] : [])].filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180).map(p => [p.latitude, p.longitude]);
  const webMap = Platform.OS === 'web' && (mapPoints.length >= 1 || estimatedMapPoints.length >= 1);
  const dimensions = large ? { width: 320, height: 210 } : compact ? { width: 72, height: 48 } : { width: 92, height: 72 };
  const allPoints = [...drawnPoints, ...reconstructedPoints];
  const hasEnoughSamples = points.length >= 2 || reconstructedPoints.length >= 2;
  const projectRoute = (route: typeof drawnPoints) => {
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
  const path = projectRoute(drawnPoints);
  const estimatedPath = projectRoute([...reconstructedPoints, ...(drawnPoints.length ? [drawnPoints[0]] : [])]);
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
      srcDoc: buildMapHtml(mapPoints, estimatedMapPoints, expanded, live, { tail: tailMapPoints, home: homePin, endNearHome, startNearHome, hasLead: Boolean(homeLead || reconstruction), hasTail: Boolean(homeTail) }, { satelliteKey: expanded ? satelliteApiKey() : null }),
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
              <View style={styles.mapHeader}>
                <View style={styles.mapSummary}>
                  <RtlText style={styles.mapSummaryMain}>
                    {[
                      homeLegsLine ? `≈ ${formatDistanceMeters(measuredDistanceMeters + homeLegsMeters)}` : formatDistanceMeters(measuredDistanceMeters),
                      measuredDurationSeconds > 0 ? `${Math.max(1, Math.round(measuredDurationSeconds / 60))} דק׳` : null,
                    ].filter(Boolean).join(' · ')}
                  </RtlText>
                  {homeLegsLine ? (
                    <RtlText style={styles.mapSummaryEstimate} numberOfLines={1}>
                      {`${formatDistanceMeters(measuredDistanceMeters)} נמדדו · ${homeLegsLine}`}
                    </RtlText>
                  ) : null}
                  {caption ? <RtlText style={styles.mapSummarySub} numberOfLines={1}>{caption}</RtlText> : null}
                </View>
                <Pressable onPress={() => setMapOpen(false)} accessibilityRole="button" accessibilityLabel="סגור מפה" style={styles.closeMap} hitSlop={8}><RtlText style={styles.closeMapText}>✕ סגירה</RtlText></Pressable>
              </View>
              <View style={[styles.expandedMap, { height: expandedMapHeight([...mapPoints, ...estimatedMapPoints, ...tailMapPoints]) }]}>{renderMap(true)}</View>
              {/* The map's own attribution control credits OpenStreetMap / OpenFreeMap. */}
              {!live ? (
                <RtlText style={styles.mapLegend} numberOfLines={1}>
                  {[homePin || reconstructedPoints.length > 1 ? '🏠 בית' : null, '▶ התחלת מדידה', homeTail ? '⏹ סוף מדידה' : endNearHome ? null : '🏁 סיום', reconstructedPoints.length > 1 || homeTail ? '- - - משוער' : null].filter(Boolean).join(' · ')}
                </RtlText>
              ) : null}
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
  mapBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 12 },
  mapCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 10, gap: 8 },
  mapHeader: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  mapSummary: { flex: 1, gap: 2 },
  mapSummaryMain: { fontSize: 17, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  mapSummarySub: { fontSize: 13, color: colors.textSecondary, textAlign: 'right' },
  mapSummaryEstimate: { fontSize: 12, color: '#B4553F', textAlign: 'right' },
  closeMap: { paddingVertical: 8, paddingHorizontal: 10 },
  closeMapText: { fontSize: 15, fontWeight: '700', color: colors.primaryDark },
  expandedMap: { width: '100%', borderRadius: 12, overflow: 'hidden' },
  mapLegend: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  largeWrapper: { width: '100%', height: 240, borderRadius: 18, backgroundColor: colors.surfaceMuted },
  incomplete: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 4 },
  legend: { position: 'absolute', bottom: 8, fontSize: 12, color: colors.textSecondary },
  legendWrap: { position: 'absolute', bottom: 3, left: 4, right: 4, backgroundColor: '#FFFFFFE8', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  lowConfidence: { fontSize: 10, color: colors.textSecondary, textAlign: 'right' },
  estimateSummary: { width: '100%', paddingHorizontal: 4, gap: 2 },
  summaryText: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
});

/**
 * Owner request 2026-11-02: fit the map's height to the route's shape. A wide,
 * low walk gets a lower map (no empty bands above and below); a tall one
 * keeps up to 70% of the screen. Accounts for the map's own fit padding
 * (26 px sides, 70 px top for the replay button, 44 px bottom for credits).
 */
export function expandedMapHeight(latLngs: number[][], window = Dimensions.get('window')): number {
  const maxHeight = Math.round(Math.min(window.height * 0.7, 640));
  const minHeight = Math.min(300, maxHeight);
  const valid = latLngs.filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (valid.length < 2) return maxHeight;
  const lats = valid.map((p) => p[0]);
  const lons = valid.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const heightM = (Math.max(...lats) - Math.min(...lats)) * 110_540;
  const widthM = (Math.max(...lons) - Math.min(...lons)) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  const mapWidthPx = Math.max(200, window.width - 44);
  const routeWidthPx = mapWidthPx - 52;
  const contentPx = widthM > 1 ? (routeWidthPx * heightM) / widthM : maxHeight;
  return Math.round(Math.max(minHeight, Math.min(maxHeight, contentPx + 114)));
}

/**
 * Owner request 2026-11-14: a clearer expanded map, with satellite imagery.
 * The small row thumbnails keep the quiet Positron basemap (owner request
 * 2026-11-02, so the walk stands out at that size); the expanded map uses
 * OpenFreeMap's Liberty style (street names, parks, buildings), still free
 * and keyless. Satellite imagery is Esri World Imagery, which needs an
 * ArcGIS API key: the "לוויין" toggle appears only when
 * EXPO_PUBLIC_ARCGIS_API_KEY is set. That key is a public, referrer-
 * restricted client key (like the Supabase publishable key), not a secret.
 */
export const QUIET_BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
export const DETAILED_BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const ESRI_IMAGERY_TILES = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Esri requires both "Powered by Esri" and the imagery providers' credit.
export const ESRI_IMAGERY_ATTRIBUTION = 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/** The ArcGIS key, or null when unset or not a plain token (it is embedded in the map's HTML). */
export function satelliteApiKey(raw: string | undefined = process.env.EXPO_PUBLIC_ARCGIS_API_KEY): string | null {
  const key = raw?.trim();
  return key && /^[A-Za-z0-9._-]{8,512}$/.test(key) ? key : null;
}

/** Free vector basemap via OpenFreeMap and MapLibre. GPS coordinates never leave the browser except as ordinary map rendering data. */
export function buildMapHtml(
  points: number[][],
  estimatedPoints: number[][],
  expanded: boolean,
  live: boolean,
  homeLegs: { tail: number[][]; home: number[] | null; endNearHome: boolean; startNearHome?: boolean; hasLead: boolean; hasTail: boolean } = { tail: [], home: null, endNearHome: false, hasLead: false, hasTail: false },
  options: { satelliteKey?: string | null } = {},
): string {
  const satelliteKey = expanded ? satelliteApiKey(options.satelliteKey ?? undefined) : null;
  const satelliteTiles = satelliteKey ? `${ESRI_IMAGERY_TILES}?token=${encodeURIComponent(satelliteKey)}` : null;
  const coords = JSON.stringify(points);
  const tailCoords = JSON.stringify(homeLegs.tail);
  const homeCoord = JSON.stringify(homeLegs.home);
  const estimateCoords = JSON.stringify(estimatedPoints);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"><style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden} .maplibregl-control-container{font:10px system-ui} .maplibregl-ctrl-attrib{font-size:10px!important} .maplibregl-ctrl-bottom-right{max-width:100%} .walk-pin{width:26px;height:26px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px #0004;display:flex;align-items:center;justify-content:center;font:700 13px system-ui;color:#fff} .walk-pin.start{background:#2F9E5B;width:20px;height:20px;font-size:9px} .walk-pin.end{background:#fff;font-size:16px} .walk-pin.home{background:#fff;font-size:15px} .walk-pin.stop{width:24px;height:24px;background:#0B5C75;font-size:10px} #basemap-toggle{position:absolute;z-index:5;top:12px;right:12px;border:0;border-radius:20px;padding:10px 14px;background:#fff;color:#183e48;font:600 14px system-ui;box-shadow:0 1px 4px #0003}</style></head><body><div id="map"></div>${expanded && !live ? '<button id="replay" style="position:absolute;z-index:5;top:12px;left:12px;border:0;border-radius:20px;padding:10px 16px;background:#fff;color:#183e48;font:600 14px system-ui">▶ נגן מסלול</button>' : ''}${satelliteTiles ? '<button id="basemap-toggle" aria-pressed="false">🛰️ לוויין</button>' : ''}<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script><script>
  const points = ${coords};
  const estimatedPoints = ${estimateCoords};
  const tailPoints = ${tailCoords};
  const homePoint = ${homeCoord};
  const allCoordinates = [...estimatedPoints,...points,...tailPoints];
  const initial = points[0] || estimatedPoints[0];
  // MapLibre's RTL plugin performs Unicode bidi shaping for Hebrew labels on vector tiles.
  // Do not reverse the text or mirror the map: both corrupt street names and route geometry.
  if(maplibregl.setRTLTextPlugin){maplibregl.setRTLTextPlugin('https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js',true).catch(()=>{});}
  const map = new maplibregl.Map({
    // Thumbnails: quiet Positron (2026-11-02). Expanded: detailed Liberty (2026-11-14).
    container:'map',style:${JSON.stringify(expanded ? DETAILED_BASEMAP_STYLE : QUIET_BASEMAP_STYLE)},
    center:[initial[1],initial[0]],zoom:16,
    interactive:${expanded ? 'true' : 'false'},attributionControl:${expanded ? '{compact:true}' : 'false'}
  });
  // The credit starts folded into the ⓘ button (tap to open it) so it does not cover the walk.
  const foldAttribution=()=>document.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show').forEach(el=>{el.classList.remove('maplibregl-compact-show');el.removeAttribute('open');});
  map.once('idle',foldAttribution);
  map.on('load',()=>{
    foldAttribution();
    const satelliteTiles=${JSON.stringify(satelliteTiles)};
    const toggle=document.getElementById('basemap-toggle');
    if(satelliteTiles && toggle){
      // Imagery sits under the style's labels (street names stay readable) and under the walk.
      const firstLabel=(map.getStyle().layers||[]).find(l=>l.type==='symbol');
      map.addSource('satellite',{type:'raster',tiles:[satelliteTiles],tileSize:256,maxzoom:19,attribution:${JSON.stringify(ESRI_IMAGERY_ATTRIBUTION)}});
      map.addLayer({id:'satellite',type:'raster',source:'satellite',layout:{visibility:'none'}},firstLabel?firstLabel.id:undefined);
      let satellite=false;
      toggle.addEventListener('click',()=>{
        satellite=!satellite;
        map.setLayoutProperty('satellite','visibility',satellite?'visible':'none');
        toggle.textContent=satellite?'🗺️ מפה':'🛰️ לוויין';
        toggle.setAttribute('aria-pressed',String(satellite));
        // Esri's credit must stay visible while its imagery is shown.
        const attrib=document.querySelector('.maplibregl-ctrl-attrib');
        if(attrib){if(satellite)attrib.classList.add('maplibregl-compact-show');else foldAttribution();}
      });
    }else if(toggle){toggle.style.display='none';}
    const coordinates=points.map(p=>[p[1],p[0]]);
    if(coordinates.length>1){
      map.addSource('walk-route',{type:'geojson',lineMetrics:true,data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates}}});
      map.addLayer({id:'walk-route-outline',type:'line',source:'walk-route',paint:{'line-color':'#ffffff','line-width':${expanded ? 11 : 7},'line-opacity':0.95},layout:{'line-join':'round','line-cap':'round'}});
      // Start-to-end colour shows the direction of the walk.
      map.addLayer({id:'walk-route-line',type:'line',source:'walk-route',paint:{'line-width':${expanded ? 7 : 4},'line-gradient':['interpolate',['linear'],['line-progress'],0,'#2F9E5B',1,'#0B5C75']},layout:{'line-join':'round','line-cap':'round'}});
      if(${expanded ? 'true' : 'false'}){
        // Small white chevrons along the line, pointing in the walking direction.
        const c=document.createElement('canvas');c.width=36;c.height=36;const g=c.getContext('2d');
        g.strokeStyle='#ffffff';g.lineWidth=5;g.lineCap='round';g.lineJoin='round';g.beginPath();g.moveTo(12,9);g.lineTo(23,18);g.lineTo(12,27);g.stroke();
        map.addImage('walk-arrow',g.getImageData(0,0,36,36),{pixelRatio:2});
        map.addLayer({id:'walk-route-arrows',type:'symbol',source:'walk-route',layout:{'symbol-placement':'line','symbol-spacing':90,'icon-image':'walk-arrow','icon-size':1,'icon-rotation-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true}});
      }
    }
    const estimated=estimatedPoints.map(p=>[p[1],p[0]]);
    if(estimated.length>1){
      map.addSource('walk-route-estimated',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:estimated}}});
      map.addLayer({id:'walk-route-estimated-line',type:'line',source:'walk-route-estimated',paint:{'line-color':'#D9705C','line-width':4,'line-dasharray':[2,2]},layout:{'line-join':'round','line-cap':'round'}});
    }
    const tail=tailPoints.map(p=>[p[1],p[0]]);
    if(tail.length>1){
      map.addSource('walk-route-tail',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:tail}}});
      map.addLayer({id:'walk-route-tail-line',type:'line',source:'walk-route-tail',paint:{'line-color':'#D9705C','line-width':4,'line-dasharray':[2,2]},layout:{'line-join':'round','line-cap':'round'}});
    }
    if(allCoordinates.length){
      const bounds=allCoordinates.map(p=>[p[1],p[0]]).reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds([allCoordinates[0][1],allCoordinates[0][0]],[allCoordinates[0][1],allCoordinates[0][0]]));
      map.fitBounds(bounds,{padding:${expanded ? "{top:70,bottom:44,left:26,right:26}" : '14'},maxZoom:${expanded ? '18.5' : '17'},duration:0});
    }
    const pin=(coord,kind,text,label)=>{const el=document.createElement('div');el.className='walk-pin '+kind;el.textContent=text;el.title=label;return new maplibregl.Marker({element:el}).setLngLat(coord).setPopup(new maplibregl.Popup({offset:18}).setText(label)).addTo(map);};
    const homeLabel=${JSON.stringify(homeLegs.hasLead && homeLegs.hasTail ? 'בית · יציאה וחזרה (משוער)' : homeLegs.hasTail ? 'בית · החזרה משוערת' : homeLegs.endNearHome ? 'בית · יציאה וסיום' : homeLegs.startNearHome ? 'בית · יציאה' : 'בית · היציאה משוערת')};
    if(${expanded ? 'true' : 'false'}){
      if(homePoint)pin([homePoint[1],homePoint[0]],'home','🏠',homeLabel);
      else if(estimated.length>1)pin(estimated[0],'home','🏠','בית (המסלול עד תחילת המדידה משוער)');
    }
    if(${expanded ? 'true' : 'false'} && coordinates.length && !${homeLegs.startNearHome ? 'true' : 'false'})pin(coordinates[0],'start','▶','תחילת מדידת GPS');
    if(${expanded ? 'true' : 'false'} && !${live ? 'true' : 'false'} && coordinates.length>1){
      if(${homeLegs.hasTail ? 'true' : 'false'})pin(coordinates[coordinates.length-1],'stop','⏹','סוף מדידת GPS');
      else if(!${homeLegs.endNearHome ? 'true' : 'false'})pin(coordinates[coordinates.length-1],'end','🏁','סיום');
    }
    if(${live ? 'true' : 'false'} && coordinates.length){
      const current=coordinates[coordinates.length-1];
      new maplibregl.Marker({color:'#1976D2',scale:0.8}).setLngLat(current).addTo(map);
      // The whole route stays in view (fitBounds above); only a lone first fix is centred (Production 2026-11-03).
      if(${expanded ? 'true' : 'false'} && coordinates.length<2)map.easeTo({center:current,zoom:17,duration:0});
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
