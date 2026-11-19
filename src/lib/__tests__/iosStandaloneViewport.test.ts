/**
 * Installed iPhone app (home-screen PWA) with the black-translucent status
 * bar: iOS lays the page out WITHOUT the status-bar area, so `height: 100%`
 * left an empty strip (≈ the top safe-area inset) under the tab bar
 * (Production report 2026-11-01). public/index.html sets --app-height to the
 * real screen height only in that mode.
 */
describe('iOS standalone viewport height', () => {
  const fs = require('fs');
  const path = require('path');
  const html: string = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');
  const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.indexOf('</script>'));

  function run(env: { standalone?: boolean; innerWidth: number; innerHeight: number; screenW: number; screenH: number }) {
    const props: Record<string, string> = {};
    const classes = new Set<string>();
    const listeners: Record<string, () => void> = {};
    const documentElement = {
      clientHeight: env.innerHeight,
      classList: { add: (c: string) => classes.add(c) },
      style: { setProperty: (k: string, v: string) => { props[k] = v; } },
    };
    const win = {
      navigator: env.standalone === undefined ? {} : { standalone: env.standalone },
      screen: { width: env.screenW, height: env.screenH },
      innerWidth: env.innerWidth,
      innerHeight: env.innerHeight,
      addEventListener: (name: string, fn: () => void) => { listeners[name] = fn; },
    };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'setTimeout', script)(win, { documentElement }, (fn: () => void) => fn());
    return { props, classes, listeners, win, documentElement };
  }

  it('fills the full screen height in the installed iPhone app (portrait)', () => {
    const r = run({ standalone: true, innerWidth: 402, innerHeight: 812, screenW: 402, screenH: 874 });
    expect(r.classes.has('ios-standalone')).toBe(true);
    expect(r.props['--app-height']).toBe('874px');
  });

  it('uses the short screen side in landscape and never shrinks below what iOS reports', () => {
    const r = run({ standalone: true, innerWidth: 874, innerHeight: 380, screenW: 402, screenH: 874 });
    expect(r.props['--app-height']).toBe('402px');
    const tall = run({ standalone: true, innerWidth: 402, innerHeight: 900, screenW: 402, screenH: 874 });
    expect(tall.props['--app-height']).toBe('900px');
  });

  it('does nothing in a normal browser tab or on non-iOS browsers', () => {
    expect(run({ standalone: false, innerWidth: 402, innerHeight: 700, screenW: 402, screenH: 874 }).classes.size).toBe(0);
    expect(run({ innerWidth: 1200, innerHeight: 800, screenW: 1920, screenH: 1080 }).classes.size).toBe(0);
  });

  it('applies the measured height to html, body and #root only in that mode', () => {
    expect(html).toMatch(/html\.ios-standalone,\s*html\.ios-standalone body,\s*html\.ios-standalone #root\s*\{\s*height: var\(--app-height, 100%\);/);
  });
});
