/**
 * One sheet at a time, in order: a sheet presents only once every sheet that
 * was asked to go has gone.
 *
 * Why this exists. A sheet that opens another from inside it (the launcher's
 * settings → model picker) flips one piece of state, so in a single commit one
 * `Sheet` goes `visible` false and another goes true. React runs their effects
 * in tree order, and the picker comes first in `Composer`, so `present()`
 * reached the native side *before* the settings sheet's `dismiss()`. TrueSheet
 * 4.1.0 presents over the topmost sheet that is not already being dismissed
 * (iOS `findPresentingViewController`; Android `TrueSheetStackManager`), so the
 * picker went on top of settings — and dismissing settings takes everything
 * above it down with it (iOS dismisses from its `presentingViewController`, a
 * whole-stack operation in UIKit; Android calls `dismissStack` first). The
 * picker appeared and vanished.
 *
 * So dismissals are recorded here, and a presentation waits one microtask (by
 * then every effect of the commit has run, whatever their order) and then for
 * every recorded dismissal to land. `dismiss()` resolves when the native
 * transition finishes, with `didDismiss`, on both platforms.
 */
let settling: Promise<unknown> = Promise.resolve();
const MAX_WAIT_MS = 1500;

/** Record a dismissal in flight; later presentations wait for it. */
export function trackDismissal(dismissal: Promise<unknown> | undefined): void {
  if (!dismissal) return;
  // Bounded: a dismissal the native side never answers must not hold every
  // later sheet down. A sheet's own transition is a few hundred milliseconds.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const landed = Promise.race([
    dismissal.catch(() => {}),
    new Promise<void>(resolve => {
      timer = setTimeout(resolve, MAX_WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  settling = Promise.all([settling, landed]);
}

/** Run `present` once every dismissal asked for so far, this commit included, has landed. */
export async function presentAfterSettled(present: () => Promise<unknown> | undefined): Promise<void> {
  await Promise.resolve();
  let waited: Promise<unknown>;
  do {
    waited = settling;
    await waited;
  } while (waited !== settling);
  await present();
}
