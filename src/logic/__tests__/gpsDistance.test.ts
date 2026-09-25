import {
  accumulateDistance,
  createGpsAccumulator,
  formatDistanceMeters,
  haversineDistanceMeters,
  MAX_ACCURACY_METERS,
  MAX_SPEED_METERS_PER_SECOND,
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
    // 30s apart, matching a realistic (generous) gap between accepted
    // fixes — ~111m/30s ≈ 3.7 m/s, well under MAX_SPEED_METERS_PER_SECOND.
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.0800, longitude: 34.7800, timestamp: 0 }));
    acc = accumulateDistance(acc, point({ latitude: 32.0810, longitude: 34.7800, timestamp: 30_000 })); // ~111m north
    acc = accumulateDistance(acc, point({ latitude: 32.0820, longitude: 34.7800, timestamp: 60_000 })); // ~111m more

    expect(acc.pointCount).toBe(3);
    expect(acc.distanceMeters).toBeGreaterThan(200);
    expect(acc.distanceMeters).toBeLessThan(240);
  });

  it('does not accumulate distance from GPS jitter below MIN_MOVEMENT_METERS', () => {
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.08000000, longitude: 34.78000000, timestamp: 0 }));
    // ~0.5m jitter — well under the floor. 5s later, matching the real
    // watchPositionAsync sampling interval (lib/gpsTracking.ts).
    acc = accumulateDistance(acc, point({ latitude: 32.08000450, longitude: 34.78000000, timestamp: 5000 }));

    expect(acc.distanceMeters).toBe(0);
    expect(acc.pointCount).toBe(2);
    // lastPoint does NOT advance to the jittered point — still the original.
    expect(acc.lastPoint).toEqual(point({ latitude: 32.08000000, longitude: 34.78000000, timestamp: 0 }));
  });

  it('regression: the sub-floor-jitter branch keeps routePoints a valid array, never dropping it (it fed straight into a live gpsStore subscriber that crashed on routePoints.map of undefined)', () => {
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.08000000, longitude: 34.78000000, timestamp: 0 }));
    expect(acc.routePoints).toEqual([point({ latitude: 32.08000000, longitude: 34.78000000, timestamp: 0 })]);
    // ~0.5m jitter — well under the floor; must not accumulate distance
    // AND must not drop routePoints off the returned accumulator.
    acc = accumulateDistance(acc, point({ latitude: 32.08000450, longitude: 34.78000000, timestamp: 5000 }));
    expect(acc.routePoints).toEqual([point({ latitude: 32.08000000, longitude: 34.78000000, timestamp: 0 })]);
  });

  it('a string of sub-floor jitters never accumulates real-looking distance by drifting against each other', () => {
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.08, longitude: 34.78, timestamp: 0 }));
    for (let i = 0; i < 20; i++) {
      // Tiny alternating jitter, each individually under MIN_MOVEMENT_METERS
      // from the ORIGINAL point, 5s apart (real sampling cadence).
      const jitter = i % 2 === 0 ? 0.0000005 : -0.0000005;
      acc = accumulateDistance(acc, point({ latitude: 32.08 + jitter, longitude: 34.78, timestamp: (i + 1) * 5000 }));
    }
    expect(acc.distanceMeters).toBe(0);
  });

  it('discards a fix less accurate than MAX_ACCURACY_METERS, without moving lastPoint or counting it', () => {
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.08, longitude: 34.78, timestamp: 0 }));
    const before = acc;
    acc = accumulateDistance(acc, point({ latitude: 32.09, longitude: 34.79, timestamp: 5000, accuracy: MAX_ACCURACY_METERS + 1 }));

    expect(acc).toEqual(before);
  });

  it('accepts a fix at exactly the accuracy threshold', () => {
    let acc = createGpsAccumulator();
    acc = accumulateDistance(acc, point({ latitude: 32.0800, longitude: 34.7800, timestamp: 0, accuracy: MAX_ACCURACY_METERS }));
    acc = accumulateDistance(acc, point({ latitude: 32.0810, longitude: 34.7800, timestamp: 30_000, accuracy: MAX_ACCURACY_METERS }));
    expect(acc.distanceMeters).toBeGreaterThan(0);
  });

  it('MIN_MOVEMENT_METERS is a small, sane floor (not accidentally huge or zero)', () => {
    expect(MIN_MOVEMENT_METERS).toBeGreaterThan(0);
    expect(MIN_MOVEMENT_METERS).toBeLessThan(20);
  });

  describe('implausible jump / speed filtering', () => {
    it('discards a fix implying speed above MAX_SPEED_METERS_PER_SECOND, without moving lastPoint or counting distance', () => {
      let acc = createGpsAccumulator();
      acc = accumulateDistance(acc, point({ latitude: 32.0800, longitude: 34.7800, timestamp: 0 }));
      const before = acc;
      // ~1.1km away, 5s later -> ~220 m/s, far above the cap. A real GPS
      // multipath/teleport artifact, not genuine dog-walk movement.
      acc = accumulateDistance(acc, point({ latitude: 32.0900, longitude: 34.7900, timestamp: 5000 }));

      expect(acc).toEqual(before);
    });

    it('accepts a fix at just under the speed cap', () => {
      let acc = createGpsAccumulator();
      acc = accumulateDistance(acc, point({ latitude: 32.0800, longitude: 34.7800, timestamp: 0 }));
      // ~35m in 5s = 7 m/s, under the 8 m/s cap.
      acc = accumulateDistance(acc, point({ latitude: 32.08031, longitude: 34.7800, timestamp: 5000 }));

      expect(acc.distanceMeters).toBeGreaterThan(0);
      expect(acc.pointCount).toBe(2);
    });

    it('a genuine teleport does not get "absorbed" into the route — later real movement resumes from the last GOOD point, not the rejected one', () => {
      let acc = createGpsAccumulator();
      acc = accumulateDistance(acc, point({ latitude: 32.0800, longitude: 34.7800, timestamp: 0 }));
      // Rejected: implausible jump.
      acc = accumulateDistance(acc, point({ latitude: 32.0900, longitude: 34.7900, timestamp: 5000 }));
      // Real movement from the ORIGINAL point, not the rejected one.
      acc = accumulateDistance(acc, point({ latitude: 32.0801, longitude: 34.7800, timestamp: 10_000 }));

      expect(acc.lastPoint).toEqual(point({ latitude: 32.0801, longitude: 34.7800, timestamp: 10_000 }));
      expect(acc.routePoints).toEqual([
        point({ latitude: 32.0800, longitude: 34.7800, timestamp: 0 }),
        point({ latitude: 32.0801, longitude: 34.7800, timestamp: 10_000 }),
      ]);
    });

    it('discards a fix whose timestamp does not move forward (duplicate or out-of-order delivery), without dividing by a non-positive elapsed time', () => {
      let acc = createGpsAccumulator();
      acc = accumulateDistance(acc, point({ latitude: 32.0800, longitude: 34.7800, timestamp: 5000 }));
      const before = acc;
      // Same timestamp as the last accepted point.
      acc = accumulateDistance(acc, point({ latitude: 32.0801, longitude: 34.7800, timestamp: 5000 }));
      expect(acc).toEqual(before);

      // Strictly earlier than the last accepted point.
      acc = accumulateDistance(acc, point({ latitude: 32.0801, longitude: 34.7800, timestamp: 4000 }));
      expect(acc).toEqual(before);
    });

    it('MAX_SPEED_METERS_PER_SECOND is a sane, generous-but-bounded cap (faster than a brisk walk, far slower than driving)', () => {
      expect(MAX_SPEED_METERS_PER_SECOND).toBeGreaterThan(3); // faster than a slow walk
      expect(MAX_SPEED_METERS_PER_SECOND).toBeLessThan(15); // slower than typical car/bike speeds
    });
  });

  describe('routePoints carries each accepted point\'s own accuracy through', () => {
    it('retains accuracy on an accepted point', () => {
      let acc = createGpsAccumulator();
      acc = accumulateDistance(acc, point({ latitude: 32.08, longitude: 34.78, timestamp: 0, accuracy: 12 }));
      acc = accumulateDistance(acc, point({ latitude: 32.0803, longitude: 34.78, timestamp: 30_000, accuracy: 8 }));

      expect(acc.routePoints.map((p) => p.accuracy)).toEqual([12, 8]);
    });

    it('a point with no accuracy reading (undefined) is still accepted and stored as-is', () => {
      let acc = createGpsAccumulator();
      acc = accumulateDistance(acc, point({ latitude: 32.08, longitude: 34.78, timestamp: 0 }));
      expect(acc.routePoints[0].accuracy).toBeUndefined();
    });
  });
});
