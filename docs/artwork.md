# Fold app wordmark

`fold-wordmark-{day,night}*.png` are 1x/2x/3x raster exports from
`home/slopcoder-glass-brand-v2/exports/logo-{day,night}.png`. They retain the
Brown Fold pile and rendered Allo glass type: black in day and white in night.
Artwork is a baked optical render, not a live refractive surface. Its loop-crown
alignment is built into the original image. `fold-pile-*` is a square transparent
in-app mark from the same source. Both live in
`Sources/Slopcoder/Resources/Images/`.

The app icons are generated from the high-resolution source in `assets/brand/`
by `scripts/generate-fold-icons.py`: the full set (light, dark, tinted) into
`App/Assets.xcassets`, and the single opaque PNG a Linux build can ship into
`App/AppIcon.png`. Native visual verification is still owed.
