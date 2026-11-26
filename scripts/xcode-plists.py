#!/usr/bin/env python3
"""Write the Info.plists an Xcode build needs, from the ones xtool uses.

App/Info.plist and App/NotificationService-Info.plist leave out what xtool
fills in by itself — the bundle identifier, the executable's name, the package
type. Xcode fills those in from build settings instead, and only where the
plist asks for them. This copies each file to build/xcode/ with those keys
added as build-setting references, so there is one source for everything else
and the two builds cannot drift apart.

Run scripts/stamp.py first if the version is to be stamped: this reads its output.
"""
import plistlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "xcode"

FROM_BUILD_SETTINGS = {
    "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)",
    "CFBundleExecutable": "$(EXECUTABLE_NAME)",
    "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleDevelopmentRegion": "en",
}


def convert(name, package_type, extra):
    with open(ROOT / "App" / name, "rb") as handle:
        plist = plistlib.load(handle)
    for key, value in {**FROM_BUILD_SETTINGS, "CFBundlePackageType": package_type, **extra}.items():
        plist.setdefault(key, value)
    # The asset catalog names the icon; a loose-file icon key would contradict it.
    plist.pop("CFBundleIconFile", None)
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "wb") as handle:
        plistlib.dump(plist, handle, sort_keys=False)
    return plist


def main():
    app = convert("Info.plist", "APPL", {"LSRequiresIPhoneOS": True, "UIRequiredDeviceCapabilities": ["arm64"]})
    ext = convert("NotificationService-Info.plist", "XPC!", {"CFBundleName": "$(PRODUCT_NAME)"})
    if (app["CFBundleShortVersionString"], app["CFBundleVersion"]) != (ext["CFBundleShortVersionString"], ext["CFBundleVersion"]):
        raise SystemExit("xcode-plists: the app and its extension carry different versions")
    print(f"wrote build/xcode: version {app['CFBundleShortVersionString']} build {app['CFBundleVersion']}")


if __name__ == "__main__":
    main()
