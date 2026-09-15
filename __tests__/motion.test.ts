/**
 * Nothing in the app may fade a view in or out through a layout animation.
 *
 * Glass is a UIVisualEffectView, which draws nothing while it or any ancestor
 * sits below full opacity, and it applies its effect once, at first layout.
 * A creation fade wrapping the composer — or the whole pushed page — left it
 * a bare card with no surface. A source-level check, because there is no
 * device in CI to see the glass go missing.
 */
import * as fs from 'fs';
import * as path from 'path';
import { slide, withKeyboard } from '../src/ui/motion';

describe('layout motion', () => {
  it('moves views without a create or delete phase', () => {
    for (const config of [slide(), slide(120), withKeyboard(250), withKeyboard(0)]) {
      expect(config.create).toBeUndefined();
      expect(config.delete).toBeUndefined();
      expect(config.update).toBeDefined();
      expect(config.duration).toBeGreaterThan(0);
    }
  });

  it('is the only place the app touches LayoutAnimation', () => {
    const src = path.join(__dirname, '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !full.endsWith(path.join('ui', 'motion.ts'))) {
          if (fs.readFileSync(full, 'utf8').includes('LayoutAnimation')) offenders.push(path.relative(src, full));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
