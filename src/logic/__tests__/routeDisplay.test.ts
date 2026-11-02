import fs from 'fs';
import path from 'path';
import { HOME_LEAD_MIN_METERS, homeLeadForDisplay, pathLengthMeters, routeForDisplay, simplifyRoute, smoothRoute } from '../routeDisplay';

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
});
