/**
 * A font name that does not resolve fails *quietly* — React Native falls back to
 * the system face and the app merely looks slightly wrong, which nobody reports.
 *
 * Both platforms find a font by the same string only because each cut's
 * PostScript name was set equal to its filename. This asserts that the names
 * `theme.ts` asks for are names that were actually shipped.
 */
import fs from 'fs';
import path from 'path';
import { font } from '../src/theme';

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const ANDROID_DIR = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'fonts');
const INFO_PLIST = path.join(__dirname, '..', 'ios', 'slopcoder_mobile', 'Info.plist');

const families = Object.values(font);

describe('fonts', () => {
  it.each(families)('%s ships as a file', family => {
    expect(fs.existsSync(path.join(FONT_DIR, `${family}.ttf`))).toBe(true);
  });

  it.each(families)('%s is bundled into the Android assets', family => {
    expect(fs.existsSync(path.join(ANDROID_DIR, `${family}.ttf`))).toBe(true);
  });

  it.each(families)('%s is registered in UIAppFonts', family => {
    expect(fs.readFileSync(INFO_PLIST, 'utf8')).toContain(`<string>${family}.ttf</string>`);
  });

  it('ships nothing the theme does not name', () => {
    const shipped = fs
      .readdirSync(FONT_DIR)
      .filter((f: string) => f.endsWith('.ttf'))
      .map((f: string) => f.replace(/\.ttf$/, ''));

    expect([...shipped].sort()).toEqual([...families].sort());
  });
});
