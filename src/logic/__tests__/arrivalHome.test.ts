import { detectArrivalHome } from '../arrivalHome';

const M = 1 / 110_540;
const home = { latitude: 32, longitude: 34.8 };
const T0 = 1_800_000_000_000;
const at = (meters: number, minute: number) => ({ latitude: 32 + meters * M, longitude: 34.8, timestamp: T0 + minute * 60_000 });

describe('detectArrivalHome', () => {
  it('detects coming back home after being away', () => {
    const route = [at(10, 0), at(200, 5), at(400, 10), at(200, 15), at(100, 17), at(30, 19), at(10, 20)];
    expect(detectArrivalHome(route, home, T0)).toEqual({ arrivedAt: T0 + 19 * 60_000, estimated: false });
  });

  it('ignores a walk that has not left home yet', () => {
    expect(detectArrivalHome([at(5, 0), at(30, 3), at(60, 6), at(20, 9)], home, T0)).toBeNull();
  });

  it('ignores passing by home on the way and walking on', () => {
    expect(detectArrivalHome([at(10, 0), at(300, 8), at(20, 14), at(250, 20)], home, T0)).toBeNull();
  });

  it('needs at least a few minutes of walking', () => {
    expect(detectArrivalHome([at(0, 0), at(150, 1), at(10, 2)], home, T0)).toBeNull();
  });

  it('estimates the arrival when GPS paused on the way back (locked phone)', () => {
    // Last fix 360 m away at minute 15; next fix at home at minute 60.
    const result = detectArrivalHome([at(10, 0), at(400, 10), at(360, 15), at(10, 60)], home, T0);
    expect(result?.estimated).toBe(true);
    // 360 m at 1.2 m/s = 5 minutes after the last fix away.
    expect(Math.round((result!.arrivedAt - T0) / 60_000)).toBe(20);
  });

  it('needs a verified home', () => {
    expect(detectArrivalHome([at(10, 0), at(400, 10), at(10, 20)], undefined, T0)).toBeNull();
  });
});
