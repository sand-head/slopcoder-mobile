"""Generate platform Fold icons. Requires Pillow; source renders are in assets/brand."""
from pathlib import Path
from PIL import Image, ImageOps
D = Path(__file__).resolve().parent.parent
B = D/'assets/brand'
APPICON = D/'ios/slopcoder_mobile/Images.xcassets/AppIcon.appiconset'

def render(theme, size, opaque):
    im=Image.open(B/f'pile-{theme}.png').convert('RGBA')
    # A conservative circular safe area survives legacy Android round masks.
    w=round(size*.62) if opaque else round(size*.70)
    h=round(w*im.height/im.width)
    im=im.resize((w,h),Image.Resampling.LANCZOS)
    out=Image.new('RGBA',(size,size),'#fbf8f4' if opaque else (0,0,0,0))
    out.alpha_composite(im,((size-w)//2,(size-h)//2))
    return out.convert('RGB') if opaque else out

def dark(size):
    """iOS's dark appearance: the night pile on nothing, so the system draws its own dark tile
    behind it rather than the cream square, which in a dark or clear home screen is a lamp."""
    im=render('night',size,False)
    # The same size as the light icon's mark, not the launch logo's larger one.
    w=round(size*.62/.70)
    small=im.resize((w,w),Image.Resampling.LANCZOS)
    out=Image.new('RGBA',(size,size),(0,0,0,0))
    out.alpha_composite(small,((size-w)//2,(size-w)//2))
    return out

def tinted(size):
    """iOS's tinted appearance, which the clear look is drawn from too: grayscale on black, where
    the system reads brightness as how much tint. The pile's own shading is kept, lifted so the
    mark reads as a bright glyph like its neighbours' rather than a grey smudge."""
    im=dark(size)
    lum=ImageOps.autocontrast(im.convert('L'),cutoff=2)
    lum=lum.point(lambda v: round(150+v*105/255))
    out=Image.new('L',(size,size),0)
    out.paste(lum,(0,0),im.getchannel('A'))
    return out

render('day',1024,True).save(APPICON/'AppIcon.png',optimize=True)
dark(1024).save(APPICON/'AppIcon-dark.png',optimize=True)
tinted(1024).save(APPICON/'AppIcon-tinted.png',optimize=True)
for scale in (1,2,3):
 for style,theme in [('light','day'),('dark','night')]:
  render(theme,96*scale,False).save(D/f'ios/slopcoder_mobile/Images.xcassets/LaunchLogo.imageset/logo-{style}@{scale}x.png',optimize=True)
for bucket,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
 for icon in ('ic_launcher','ic_launcher_round'):
  render('day',size,True).save(D/f'android/app/src/main/res/mipmap-{bucket}/{icon}.png',optimize=True)
