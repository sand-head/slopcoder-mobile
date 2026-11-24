/**
 * The app's layout animations, and the one rule they all follow: things
 * move, they never fade.
 *
 * `LayoutAnimation.Presets.easeInEaseOut` — and `LayoutAnimation.create`,
 * whose third argument is required — fade every view created or deleted in
 * the next commit through its opacity. Glass cannot survive that. A
 * `UIVisualEffectView` draws nothing while it or any ancestor has an alpha
 * under 1, and the glass in this app applies its effect exactly once, at
 * first layout; a surface that lays out mid-fade takes its effect with the
 * page still transparent behind it and never draws it. The composer, the
 * jump-to-latest button and the cockpit's bar are all glass, and the whole
 * pushed page is a "created view" when the sessions list happens to reload
 * in the same commit as the tap that opened it. That was the composer
 * sometimes arriving as a flat card with no surface at all.
 *
 * So no config here has a `create` or `delete` phase. New rows appear, old
 * ones go, and everything around them slides into place — which is all the
 * callers ever wanted.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, LayoutAnimation, type LayoutAnimationConfig } from 'react-native';

// Unknown means still until the OS preference is known. All subscribers watch
// the same system value; App subscribes even when no animated child is mounted.
let reduceMotion = true;
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let alive = true;
    let changed = false;
    const update = (value: boolean) => {
      if (alive) { reduceMotion = value; setReduced(value); }
    };
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true;
      update(value);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!changed) update(value);
    }).catch(() => { /* Safe still state on failure. */ });
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}


/** Neighbours slide as a row grows, folds, appears or leaves. */
export function slide(duration = 300): LayoutAnimationConfig {
  return { duration, update: { type: LayoutAnimation.Types.easeInEaseOut } };
}

/** `LayoutAnimation.configureNext`, with the rule above built in. */
export function animateNextLayout(config: LayoutAnimationConfig = slide()) {
  if (!reduceMotion) LayoutAnimation.configureNext(config);
}
