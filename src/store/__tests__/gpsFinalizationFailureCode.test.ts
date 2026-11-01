import { gpsFinalizationFailureCode } from '../scheduleStore';

/**
 * Production 2026-11-01: "הטיול הסתיים, אך לא הצלחנו לשמור את נתוני ה-GPS"
 * appeared after short walks with no failing request on the server, so the
 * cause was on the device. The notice now carries a short code naming the
 * step that failed.
 */
describe('gpsFinalizationFailureCode', () => {
  it('names a lost GPS lease', () => {
    expect(gpsFinalizationFailureCode(new Error('GPS route was not saved because this device no longer owns GPS for the walk'))).toBe('GPS-L');
    expect(gpsFinalizationFailureCode(new Error('GPS ownership expired or transferred'))).toBe('GPS-L');
  });

  it('names an offline device', () => {
    expect(gpsFinalizationFailureCode(new Error('GPS route is buffered locally until ownership can be verified online'))).toBe('GPS-N');
  });

  it('names a server refusal of the route upload', () => {
    expect(gpsFinalizationFailureCode(new Error('append_walk_gps_route_v11 failed: invalid points'))).toBe('GPS-S');
  });

  it('falls back to a generic code without echoing the message', () => {
    expect(gpsFinalizationFailureCode(new Error('something else entirely'))).toBe('GPS-E');
    expect(gpsFinalizationFailureCode(undefined)).toBe('GPS-E');
  });
});
