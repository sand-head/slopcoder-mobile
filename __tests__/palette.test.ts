import { paletteFor } from '../src/theme';

function luminance(hex: string) {
  const components = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * components[0] + 0.7152 * components[1] + 0.0722 * components[2];
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('approved neutral session surfaces and emerald remain legible in both modes', () => {
  const light = paletteFor(false); const dark = paletteFor(true);
  expect([light.foreground, light.mutedForeground, light.secondary, light.primary]).toEqual(['#24232d', '#625e6e', '#f0eef3', '#007a55']);
  expect([dark.background, dark.card, dark.foreground, dark.mutedForeground, dark.secondary, dark.primary]).toEqual(['#17171d', '#222229', '#eeebf3', '#b9b3c5', '#29272e', '#00bc7d']);
  expect([light.userBubble, dark.userBubble]).toEqual(['#f0eef3', '#29272e']);
  for (const p of [light, dark]) {
    expect(contrast(p.foreground, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.foreground, p.secondary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.mutedForeground, p.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.primaryForeground, p.primary)).toBeGreaterThanOrEqual(4.5);
  }
});
