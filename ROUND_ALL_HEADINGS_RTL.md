# RTL heading alignment follow-up

This follow-up anchors screen and section headings to the physical right edge instead of relying only on `textAlign: 'right'` inside stretched RTL containers.

Updated:
- Home section headings
- Schedule screen header/day/section headings
- Family header/subheader
- History header/section headings/subtitle
- Statistics header/card headings
- Settings header/advanced section headings
- Spontaneous-walk duration and note labels

Technique: `alignSelf: 'flex-end'` + RTL text writing direction on heading/label text, matching the Home fix already verified on-device.
