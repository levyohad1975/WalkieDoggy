import fs from 'fs';
import path from 'path';
import { HOME_LEAD_MIN_METERS, homeLeadForDisplay, homeLegsSummary, homeTailForDisplay, pathLengthMeters, routeForDisplay, simplifyRoute, smoothRoute } from '../routeDisplay';

const METER_LAT = 1 / 110_540;

/** A straight 200 m walk north with ±8 m sideways GPS wander every other fix. */
function noisyStraightWalk() {
  return Array.from({ length: 41 }, (_, i) => ({
    latitude: 32 + i * 5 * METER_LAT,
    longitude: 34.8 + (i % 2 === 0 ? 8 : -8) / (111_320 * Math.cos((32 * Math.PI) / 180)),
    timestamp: 1_800_000_000_000 + i * 4000,
    accuracy: 10,
  }));
}

describe('route display clean-up (drawing only)', () => {
  it('turns GPS wander along a straight walk into a near-straight line', () => {
    const raw = noisyStraightWalk();
    const drawn = routeForDisplay(raw);
    expect(pathLengthMeters(raw)).toBeGreaterThan(600); // zigzag
    expect(pathLengthMeters(drawn)).toBeLessThan(260); // ~200 m walk
    expect(drawn.length).toBeLessThan(raw.length);
  });

  it('keeps the first and last fixes exactly, so start/end pins do not move', () => {
    const raw = noisyStraightWalk();
    const drawn = routeForDisplay(raw);
    expect(drawn[0]).toEqual(raw[0]);
    expect(drawn[drawn.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('orders by time and lets an inaccurate fix pull the line less', () => {
    const base = { longitude: 34.8, accuracy: 5 };
    const points = [
      { ...base, latitude: 32, timestamp: 1 },
      { ...base, latitude: 32 + 30 * METER_LAT, timestamp: 3 },
      { latitude: 32 + 10 * METER_LAT, longitude: 34.8 + 0.0004, timestamp: 2, accuracy: 45 },
    ];
    const smoothed = smoothRoute([...points].sort((a, b) => a.timestamp - b.timestamp));
    expect(routeForDisplay(points).map((p) => p.timestamp)[0]).toBe(1);
    expect(smoothed.map((p) => p.timestamp)).toEqual([1, 2, 3]);
    expect(Math.abs(smoothed[1].longitude - 34.8)).toBeLessThan(0.00002);
  });

  it('never drops a real corner', () => {
    const corner = [
      { latitude: 32, longitude: 34.8, timestamp: 1 },
      { latitude: 32 + 100 * METER_LAT, longitude: 34.8, timestamp: 2 },
      { latitude: 32 + 100 * METER_LAT, longitude: 34.8 + 0.001, timestamp: 3 },
    ];
    expect(simplifyRoute(corner)).toHaveLength(3);
  });

  it('is applied by RoutePreview only to what is drawn, never to the stored distance', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../components/RoutePreview.tsx'), 'utf8');
    expect(source).toContain('const drawnPoints = useMemo(() => (live ? points : routeForDisplay(points)), [points, live]);');
    expect(source).toContain("style:'https://tiles.openfreemap.org/styles/positron'");
    expect(source).toContain("'line-gradient'");
    expect(source).toContain('attributionControl:${expanded ? \'{compact:true}\' : \'false\'}');
  });

  it('completes a late start from home as an estimated straight lead (owner rule: walks start at home)', () => {
    const home = { latitude: 32, longitude: 34.8 };
    const far = { latitude: 32 + 300 * METER_LAT, longitude: 34.8 };
    const lead = homeLeadForDisplay(home, far);
    expect(lead?.routePoints).toEqual([{ ...home, timestamp: 0 }, { ...far, timestamp: 0 }]);
    expect(Math.round(lead!.distanceMeters)).toBeGreaterThan(290);
    expect(homeLeadForDisplay(home, { latitude: 32 + (HOME_LEAD_MIN_METERS - 10) * METER_LAT, longitude: 34.8 })).toBeNull();
    expect(homeLeadForDisplay(undefined, far)).toBeNull();
  });

  it('RoutePreview uses a saved reconstruction first and the home lead only without one', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../components/RoutePreview.tsx'), 'utf8');
    expect(source).toContain('(reconstruction ? null : homeLeadForDisplay(home, drawnPoints[0]))');
    expect(source).toContain('reconstruction?.routePoints ?? homeLead?.routePoints ?? []');
    expect(source).toContain("pin(estimated[0],'home','🏠'");
  });

  it('completes a measurement that stopped away from home back to home, and merges the pins near home', () => {
    const home = { latitude: 32, longitude: 34.8 };
    const stop = { latitude: 32 + 200 * METER_LAT, longitude: 34.8 };
    const tail = homeTailForDisplay(home, stop);
    expect(tail?.routePoints).toEqual([{ ...stop, timestamp: 0 }, { ...home, timestamp: 0 }]);
    expect(homeTailForDisplay(home, { latitude: 32 + 20 * METER_LAT, longitude: 34.8 })).toBeNull();
    const fmt = (m: number) => `${Math.round(m)} מ'`;
    expect(homeLegsSummary(100, 200, fmt)).toBe("300 מ' משוער מהבית ובחזרה");
    expect(homeLegsSummary(97, null, fmt)).toBe("97 מ' משוער מהבית");
    expect(homeLegsSummary(null, 200, fmt)).toBe("200 מ' משוער חזרה הביתה");
    expect(homeLegsSummary(null, null, fmt)).toBeNull();
    const source = fs.readFileSync(path.resolve(__dirname, '../../components/RoutePreview.tsx'), 'utf8');
    expect(source).toContain("else if(!${homeLegs.endNearHome ? 'true' : 'false'})pin(coordinates[coordinates.length-1],'end','🏁','סיום');");
    expect(source).toContain("pin(coordinates[coordinates.length-1],'stop','⏹','סוף מדידת GPS')");
  });

  it('draws a walk that ended next to home reaching the home pin, with a total-first header', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../components/RoutePreview.tsx'), 'utf8');
    expect(source).toContain('...(endNearHome ? [homePin] : []),');
    expect(source).toContain('...(startNearHome ? [homePin] : []),');
    expect(source).toContain("homeLegsLine ? `≈ ${formatDistanceMeters(measuredDistanceMeters + homeLegsMeters)}`");
    expect(source).toContain("maxZoom:${expanded ? '18.5' : '17'}");
  });
});

describe('expanded map height follows the route shape', () => {
  const { expandedMapHeight } = require('../../components/RoutePreview');
  const window = { width: 390, height: 844, scale: 3, fontScale: 1 };
  it('a wide, low walk gets a lower map; a tall walk keeps the full height', () => {
    const wide = [[32, 34.8], [32 + 80 * METER_LAT, 34.8 + 0.004]];
    const tall = [[32, 34.8], [32 + 600 * METER_LAT, 34.8 + 0.001]];
    const max = Math.round(Math.min(844 * 0.7, 640));
    expect(expandedMapHeight(wide, window)).toBeLessThan(max);
    expect(expandedMapHeight(wide, window)).toBeGreaterThanOrEqual(300);
    expect(expandedMapHeight(tall, window)).toBe(max);
    expect(expandedMapHeight([[32, 34.8]], window)).toBe(max);
  });
});
