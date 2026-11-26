# Fonts

In `Sources/Slopcoder/Resources/Fonts/`, bundled with the app target and registered at
launch by `AppFont.register()` — there is no `UIAppFonts` entry to keep in step.

| File | Source | Weight |
|---|---|---|
| `Allo-Regular.ttf` | Allo (variable original: `home/slopcoder-prism/assets/AlloVariable.woff2`) | 400 |
| `Allo-Medium.ttf` | Allo | 600 |
| `GeistMono-Regular.ttf` | [Geist Mono](https://github.com/vercel/geist-font) | 400 |
| `GeistMono-SemiBold.ttf` | Geist Mono | 600 |

All are licensed under the SIL Open Font License 1.1 — `OFL.txt` for Geist Mono,
`Allo-OFL.txt` for Allo. Neither declares a Reserved Font Name, so the derivatives below
are permitted.

## What was done to them

Both families are distributed as variable fonts. Each was instanced to the static cuts the
app uses with `fontTools` (`fontTools.varLib.instancer`; Allo at opsz 14 / ROND 60), and each
cut's family, full and PostScript names were set equal to its filename — iOS looks a custom font up by PostScript name, so
`AppFont.sansName` and the other three constants are exactly the filenames without `.ttf`.

Pick a family from `AppFont` (`sans`, `sansMedium`, `mono`, `monoSemiBold`), never a weight:
there is no weight axis left to ask for, and `.fontWeight` beside one does nothing useful.

To add a cut: instance it, flatten its names the same way, drop it in this directory, and
add it to `AppFont` — both the name constant and the list `register()` walks.

The React Native app also shipped Geist (sans) and Baloo 2; nothing in the Swift app uses
them, so they were not carried over. They are in the history at `3c8a82f`.
