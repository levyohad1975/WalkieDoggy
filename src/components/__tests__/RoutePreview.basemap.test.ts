import { buildMapHtml, DETAILED_BASEMAP_STYLE, ESRI_IMAGERY_TILES, QUIET_BASEMAP_STYLE, satelliteApiKey } from '../RoutePreview';

const route = [[32.0, 34.8], [32.001, 34.801]];
const KEY = 'AAPTxy8BH1VEsoebNVZXo8HurEOF051kAEeFr7S';

describe('RoutePreview basemaps (owner request 2026-11-14)', () => {
  it('keeps the quiet Positron basemap for row thumbnails', () => {
    const html = buildMapHtml(route, [], false, false, undefined, { satelliteKey: KEY });
    expect(html).toContain(QUIET_BASEMAP_STYLE);
    expect(html).not.toContain(DETAILED_BASEMAP_STYLE);
    // Never satellite on a thumbnail, even when a key exists.
    expect(html).not.toContain('basemap-toggle"');
    expect(html).not.toContain(KEY);
  });

  it('uses the detailed Liberty basemap for the expanded map', () => {
    const html = buildMapHtml(route, [], true, false);
    expect(html).toContain(DETAILED_BASEMAP_STYLE);
    expect(html).not.toContain(QUIET_BASEMAP_STYLE);
  });

  it('offers no satellite toggle without an ArcGIS key', () => {
    const html = buildMapHtml(route, [], true, false, undefined, { satelliteKey: null });
    expect(html).not.toContain('id="basemap-toggle"');
    expect(html).not.toContain(ESRI_IMAGERY_TILES);
  });

  it('adds the satellite toggle, Esri imagery and its credit when a key is set', () => {
    const html = buildMapHtml(route, [], true, false, undefined, { satelliteKey: KEY });
    expect(html).toContain('id="basemap-toggle"');
    expect(html).toContain('🛰️ לוויין');
    expect(html).toContain(`${ESRI_IMAGERY_TILES}?token=${KEY}`);
    expect(html).toContain('Powered by');
    expect(html).toContain('Maxar');
  });

  it('rejects keys that are not plain tokens, so nothing can be injected into the map page', () => {
    expect(satelliteApiKey(undefined)).toBeNull();
    expect(satelliteApiKey('   ')).toBeNull();
    expect(satelliteApiKey('abc"</script><script>alert(1)</script>')).toBeNull();
    expect(satelliteApiKey(`  ${KEY}  `)).toBe(KEY);
    const html = buildMapHtml(route, [], true, false, undefined, { satelliteKey: 'bad key"<x>' });
    expect(html).not.toContain('id="basemap-toggle"');
  });
});
