import {
  accumulateDistance,
  createGpsAccumulator,
  formatDistanceMeters,
  haversineDistanceMeters,
  MAX_ACCURACY_METERS,
  MIN_MOVEMENT_METERS,
  type GpsPoint,
} from '../gpsDistance';

describe('formatDistanceMeters', () => {
  it('formats under 1km in whole meters', () => {
    expect(formatDistanceMeters(850)).toBe("850 מ'");
    expect(formatDistanceMeters(3.4)).toBe("3 מ'");
  });
  it('formats 1km and above in km with 2 decimals', () => {
    expect(formatDistanceMeters(1000)).toBe('1.00 ק״מ');
    expect(formatDistanceMeters(1240)).toBe('1.24 ק״מ');
  });
});

const point = (patch: Partial<GpsPoint>): GpsPoint => ({ latitude: 32.0853, longitude: 34.7818, timestamp: 0, ...patch });

describe('haversineDistanceMeters', () => {
  it('is zero for the same point', () => {
    const p = point({});
    expect(haversineDistanceMeters(p, p)).toBe(0);
  });

  it('computes a known real-world distance within a small tolerance (Tel Aviv landmark ~1km apart)', () => {
    // Rabin Square to Habima Square, Tel Aviv — real coordinates, ~1.0km apart.
    const a = point({ latitude: 32.0808, longitude: 34.7805 });
    const b = point({ latitude: 32.0736, longitude: 34.7754 });
    const d = haversineDistanceMeters(a, b);
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(1300);
  });

  it('is symmetric', () => {
    const a = point({ latitude: 32.08, longitude: 34.78 });
    const b = point({ latitude: 32.09, longitude: 34.79 });
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });
});

describe('accumulateDistance', () => {
  it('the first point establishes lastPoint and contributes zero distance', () => {
    const acc = accumulateDistance(createGpsAccumulator(), point({ timestamp: 1 }));
    expect(acc.distanceMeters).toBe(0);
    expect(acc.pointCount).toBe(1);
    expect(acc.lastPoint).toEqual(point({ timestamp: 1 }));
  });

  it('sums real movement across multiple points', () => {
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.0800, longitude: 34.7800, timestamp: 1 }));
    acc = accumulateDistance(acc, point({ latitude: 32.0810, longitude: 34.7800, timestamp: 2 })); // ~111m north
    acc = accumulateDistance(acc, point({ latitude: 32.0820, longitude: 34.7800, timestamp: 3 })); // ~111m more

    expect(acc.pointCount).toBe(3);
    expect(acc.distanceMeters).toBeGreaterThan(200);
    expect(acc.distanceMeters).toBeLessThan(240);
  });

  it('does not accumulate distance from GPS jitter below MIN_MOVEMENT_METERS', () => {
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.08000000, longitude: 34.78000000, timestamp: 1 }));
    // ~0.5m jitter — well under the floor.
    acc = accumulateDistance(acc, point({ latitude: 32.08000450, longitude: 34.78000000, timestamp: 2 }));

    expect(acc.distanceMeters).toBe(0);
    expect(acc.pointCount).toBe(2);
    // lastPoint does NOT advance to the jittered point — still the original.
    expect(acc.lastPoint).toEqual(point({ latitude: 32.08000000, longitude: 34.78000000, timestamp: 1 }));
  });

  it('a string of sub-floor jitters never accumulates real-looking distance by drifting against each other', () => {
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.08, longitude: 34.78, timestamp: 1 }));
    for (let i = 0; i < 20; i++) {
      // Tiny alternating jitter, each individually under MIN_MOVEMENT_METERS
      // from the ORIGINAL point.
      const jitter = i % 2 === 0 ? 0.0000005 : -0.0000005;
      acc = accumulateDistance(acc, point({ latitude: 32.08 + jitter, longitude: 34.78, timestamp: i + 2 }));
    }
    expect(acc.distanceMeters).toBe(0);
  });

  it('discards a fix less accurate than MAX_ACCURACY_METERS, without moving lastPoint or counting it', () => {
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.08, longitude: 34.78, timestamp: 1 }));
    const before = acc;
    acc = accumulateDistance(acc, point({ latitude: 32.09, longitude: 34.79, timestamp: 2, accuracy: MAX_ACCURACY_METERS + 1 }));

    expect(acc).toEqual(before);
  });

  it('accepts a fix at exactly the accuracy threshold', () => {
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.0800, longitude: 34.7800, timestamp: 1, accuracy: MAX_ACCURACY_METERS }));
    acc = accumulateDistance(acc, point({ latitude: 32.0810, longitude: 34.7800, timestamp: 2, accuracy: MAX_ACCURACY_METERS }));
    expect(acc.distanceMeters).toBeGreaterThan(0);
  });

  it('MIN_MOVEMENT_METERS is a small, sane floor (not accidentally huge or zero)', () => {
    expect(MIN_MOVEMENT_METERS).toBeGreaterThan(0);
    expect(MIN_MOVEMENT_METERS).toBeLessThan(20);
  });
});
