# Fonts

| File | Source | Weight |
|---|---|---|
| `Geist-Regular.ttf` | [Geist](https://github.com/vercel/geist-font) | 400 |
| `Geist-Medium.ttf` | Geist | 500 |
| `GeistMono-Regular.ttf` | [Geist Mono](https://github.com/vercel/geist-font) | 400 |
| `GeistMono-SemiBold.ttf` | Geist Mono | 600 |
| `Baloo2-ExtraBold.ttf` | [Baloo 2](https://github.com/EkType/Baloo2) | 800 |

All are licensed under the SIL Open Font License 1.1 — see `OFL.txt`. Neither family
declares a Reserved Font Name, so the derivatives below are permitted.

## What was done to them

Geist and Geist Mono are distributed as variable fonts. React Native honours no weight
axis, so each is instanced to a static cut with `fontTools`:

```python
from fontTools.varLib import instancer
static = instancer.instantiateVariableFont(font, {'wght': 500}, updateFontNames=False)
```

Each cut then has its name table flattened so that family, full and **PostScript** name all
equal the filename, and `OS/2.usWeightClass` set to the instanced weight. That flattening is
what lets one `fontFamily` string resolve on both platforms: iOS looks a font up by its
PostScript name, Android by its asset filename.

Baloo 2 was already static; only its names were flattened.
