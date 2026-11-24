"""Generate platform Fold icons. Requires Pillow; source renders are in assets/brand."""
from pathlib import Path
from PIL import Image
D = Path(__file__).resolve().parent.parent
B = D/'assets/brand'

def render(theme, size, opaque):
    im=Image.open(B/f'pile-{theme}.png').convert('RGBA')
    # A conservative circular safe area survives legacy Android round masks.
    w=round(size*.62) if opaque else round(size*.70)
    h=round(w*im.height/im.width)
    im=im.resize((w,h),Image.Resampling.LANCZOS)
    out=Image.new('RGBA',(size,size),'#fbf8f4' if opaque else (0,0,0,0))
    out.alpha_composite(im,((size-w)//2,(size-h)//2))
    return out.convert('RGB') if opaque else out

render('day',1024,True).save(D/'ios/slopcoder_mobile/Images.xcassets/AppIcon.appiconset/AppIcon.png',optimize=True)
for scale in (1,2,3):
 for style,theme in [('light','day'),('dark','night')]:
  render(theme,96*scale,False).save(D/f'ios/slopcoder_mobile/Images.xcassets/LaunchLogo.imageset/logo-{style}@{scale}x.png',optimize=True)
for bucket,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
 for icon in ('ic_launcher','ic_launcher_round'):
  render('day',size,True).save(D/f'android/app/src/main/res/mipmap-{bucket}/{icon}.png',optimize=True)
