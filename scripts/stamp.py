#!/usr/bin/env python3
"""Write a release's version, build number and push settings into the bundle's plists.

xtool merges App/Info.plist into the app as it is: there are no build settings
and nothing is substituted. So a release rewrites the files before building.
Only the values change — the files keep their comments — but the result is
still not something to commit: a release builds in a tree that is thrown away.

    scripts/stamp.py --version 2026.11.25 --build 42 \\
        --relay https://push.example.com --aps production

Every argument is optional; what is not given is left as it was.
"""
import argparse
import plistlib
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "App"
INFO_PLISTS = [APP / "Info.plist", APP / "NotificationService-Info.plist"]
APP_INFO = APP / "Info.plist"
APP_ENTITLEMENTS = APP / "Slopcoder.entitlements"


def set_string(path, key, value):
    """Replace the <string> that follows <key>key</key>, leaving the rest of the file — its
    comments above all — exactly as written. plistlib would re-serialise it without them."""
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r"(<key>" + re.escape(key) + r"</key>\s*)<string>[^<]*</string>")
    replaced, count = pattern.subn(lambda found: f"{found.group(1)}<string>{escape(value)}</string>", text)
    if count != 1:
        sys.exit(f"stamp: expected one <string> for {key} in {path.name}, found {count}")
    path.write_text(replaced, encoding="utf-8")
    # Whatever was written must still be a plist, and must say what was asked.
    with open(path, "rb") as handle:
        if plistlib.load(handle).get(key) != value:
            sys.exit(f"stamp: {path.name} did not take {key}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", help="CFBundleShortVersionString, e.g. 2026.11.25")
    parser.add_argument("--build", help="CFBundleVersion; App Store Connect refuses one it has seen")
    parser.add_argument("--relay", help="SlopcoderPushRelay: an https URL, or empty for no notifications")
    parser.add_argument("--aps", choices=["development", "production"], help="the aps-environment entitlement")
    args = parser.parse_args(argv)

    if args.version is not None and not re.fullmatch(r"\d+(\.\d+){0,2}", args.version):
        sys.exit(f"stamp: {args.version!r} is not a version Apple accepts (up to three dotted integers)")
    if args.build is not None and not re.fullmatch(r"\d+(\.\d+){0,2}", args.build):
        sys.exit(f"stamp: {args.build!r} is not a build number Apple accepts")
    if args.relay and not args.relay.startswith("https://"):
        sys.exit("stamp: the push relay must be an https URL")

    # An extension's version has to match its app's, so both files get the same two values.
    for path in INFO_PLISTS:
        if args.version is not None:
            set_string(path, "CFBundleShortVersionString", args.version)
        if args.build is not None:
            set_string(path, "CFBundleVersion", args.build)
    if args.relay is not None:
        set_string(APP_INFO, "SlopcoderPushRelay", args.relay)
    if args.aps is not None:
        set_string(APP_ENTITLEMENTS, "aps-environment", args.aps)

    with open(APP_INFO, "rb") as handle:
        info = plistlib.load(handle)
    relay = info.get("SlopcoderPushRelay") or "(none: notifications off)"
    print(f"version {info['CFBundleShortVersionString']} build {info['CFBundleVersion']} relay {relay}")


if __name__ == "__main__":
    main()
