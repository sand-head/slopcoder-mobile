# Getting a build into TestFlight

The repo is set up so a button does the work: **Actions → release → Run
workflow** runs `.github/workflows/release.yml`, which archives, signs, and
uploads whatever is on the branch you pick.

Everything else here builds on Linux with xtool. A TestFlight build is the one
exception: it is made by Xcode on a Mac runner, because distribution signing,
a compiled asset catalog and the upload are things only a Mac does. It builds
the same Swift package — `project.yml` is two empty targets that link
`Package.swift`'s products.

**This path has not run yet.** It was written without a Mac to try it on.
`ci.yml`'s `ui-tests` job generates the same project and builds it (Debug, for
the simulator) on every push to `main`, so a broken project shows there first;
a mistake only a Release device build makes will show on the day of a release.

**If you set this up for the React Native app, one thing changed:** the app now
shares its push keys with the notification extension through an App Group, so
both App IDs need the App Groups capability and both provisioning profiles need
regenerating (section 1). The release checks for this and says so if not.

What follows is the one-time setup on Apple's side that a workflow cannot do
for you. None of it needs a Mac.

The app's bundle identifier is **`codes.sand.slopcoder`**. It appears in
`xtool.yml`, the URL type in `App/Info.plist`, and the Keychain service the app
signs in with. There is a second bundle: the notification service extension,
**`codes.sand.slopcoder.NotificationService`**, which decrypts pushes before iOS
shows them. It is its own App ID and its own provisioning profile, signed with
the same certificate. `PackagingTests` fails if the plists, the entitlements and
`xtool.yml` drift apart.

---

## 1. Apple Developer portal

You never create a Team ID — Apple assigns one with your membership, and the
release job reads it back out of the provisioning profile, so there is nothing
to look up here. If you want to see it anyway: developer.apple.com/account →
**Membership details** in the sidebar, or the **App ID Prefix** shown beside the
App ID once you have made one. Ten characters.

**App ID** — Certificates, IDs & Profiles → Identifiers → **+** → App IDs → App.

- Bundle ID: **Explicit**, `codes.sand.slopcoder`.
- Capabilities: tick **Push Notifications** and **App Groups**.

**App Group** — Identifiers → **+** → App Groups → `group.codes.sand.slopcoder`.
Then back on the App ID, under App Groups → Configure, select it.

The rule is that the profile must cover every entitlement the app *claims*, and
the app claims two (`App/Slopcoder.entitlements`): `aps-environment`, which is
the Push Notifications capability, and the App Group. The group is where the
push keys live: the app writes them to a Keychain item filed under it, and the
extension reads them from there. The React Native build used the app's own
identifier prefix as a Keychain group instead, which needed nothing ticked —
but xtool's signer rewrites that entitlement to each bundle's own identifier,
which would leave the extension unable to see the app's item.

**Extension App ID** — the same page, **+** again → App IDs → App.

- Bundle ID: **Explicit**, `codes.sand.slopcoder.NotificationService`.
- Capabilities: **App Groups**, configured with the same group. Nothing else.

**Siri is not one of them**, despite the app having Siri intents. That capability
belongs to SiriKit, which this app does not use — `Sources/Slopcoder/Intents/`
is App Intents, which needs no entitlement.

**Distribution certificate** — every guide for this says "open Keychain
Access". You do not need a Mac; Apple only ever sees a certificate signing
request, and OpenSSL makes one.

Work somewhere outside the repo — `~/.local/share/slopcoder-signing`, say. The
private key is the half Apple never gets, and losing it means revoking the
certificate and starting over.

```sh
# 1. A key, and a request Apple will sign.
openssl genrsa -out distribution.key 2048
openssl req -new -key distribution.key -out distribution.csr \
  -subj "/emailAddress=<your Apple ID>/CN=<your name>/C=US"
```

Apple takes only the public key out of that request. The subject is discarded
and the issued certificate carries one minted from your account — `Apple
Distribution: <name> (<team id>)` — so the email here changes nothing. Use the
Apple ID address regardless: it is free to get right, and a mismatch is one more
thing to second-guess when something else goes wrong six months from now.

Then Certificates → **+** → *Apple Distribution* → upload `distribution.csr` →
download the `.cer`. It comes back DER-encoded, and the `.p12` CI wants is that
certificate and your private key in one file:

```sh
# 2. DER to PEM, then bundle with the key.
openssl x509 -inform DER -in distribution.cer -out distribution.pem
openssl pkcs12 -export -inkey distribution.key -in distribution.pem \
  -name "Apple Distribution" -out distribution.p12 \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
```

The three algorithm flags pick the 3DES/SHA-1 form, which every tool that reads
a `.p12` understands; OpenSSL 3's default (AES-256-CBC with an SHA-256 MAC) is
not read reliably by Apple's own. Remember the password you type at the export
prompt: whatever signs the build will need the file and the password together.

**Provisioning profiles** — Profiles → **+** → *App Store Connect* → pick the App
ID and the distribution certificate. Download the `.mobileprovision`.

Then once more for the extension's App ID, with the same certificate: two
profiles. Make them after the App Group is configured — a profile is a snapshot
of its App ID's capabilities, and one made earlier does not cover the group.

**APNs key** — Keys → **+** → tick *Apple Push Notifications service*. Under
Configure, leave the environment on **Sandbox & Production**: a token-based key
is not environment-scoped the way the old APNs certificates were, and the
sandbox-only restriction would leave every TestFlight and App Store build with
no notifications.

Leave **Key Restriction** off as well. The app a notification is for is chosen
per send — `ApnsSender` puts the configured bundle id in the `apns-topic` header
— so one unrestricted key serves every app you ever ship, while a scoped one
would spend a slot per app and Apple allows **two keys per account**. The cost
is blast radius: an unrestricted key can push to anything in the team, so treat
the `.p8` as a private key rather than as a config value.

Download it; no CSR and no OpenSSL here, Apple generates this one whole.

Nothing in slopcoder selects an environment either — the app reports whether it
holds a sandbox token (`PushEnvironment`, read from the profile it was signed
with) and the server picks the matching APNs host per device (`ApnsSender.cs`).
One key covers both.

**The key is for the server, not for CI** — it fills slopcoder's
`Push:Apns:{KeyId,TeamId,BundleId,PrivateKey}` on the deployment that acts as
the **push relay**. Confusing it with the App Store Connect key below is the
single easiest mistake here; both are `.p8` files from different pages, and
neither can be downloaded twice.

**The relay is yours, not the user's.** The app never sends its APNs token to
the instance it signs in to. It sends it to the relay — the deployment whose
address is stamped into the build from `SLOPCODER_PUSH_RELAY` — and gets back a
Web Push endpoint, which it subscribes on its own instance with. So anyone can
host slopcoder and have this app notify them, with nothing from Apple; only
the deployment that ships the app holds the key. See `docs/push-relay.md` in
the slopcoder repo for the protocol.

## 2. App Store Connect

**App record** — My Apps → **+** → New App. Platform iOS, the bundle ID from the
list, a name, and an SKU (any stable string; `slopcoder-mobile` is fine).

**API key** — Users and Access → Integrations → App Store Connect API →
**+**, role *App Manager*. You get a **Key ID**, an **Issuer ID** (shown once at
the top of the page, shared by all keys), and a `.p8` that downloads **exactly
once**.

None of the above needs macOS. The only Mac in this pipeline is the runner.

## 3. Repository secrets

Settings → Secrets and variables → Actions. Base64 with `base64 -w0 <file>` on
Linux, `base64 -i <file> | pbcopy` on macOS.

| Secret | From |
|---|---|
| `IOS_CERTIFICATE_BASE64` | the `.p12`, base64'd |
| `IOS_CERTIFICATE_PASSWORD` | the password you set exporting it |
| `IOS_PROVISIONING_PROFILE_BASE64` | the app's `.mobileprovision`, base64'd |
| `IOS_EXTENSION_PROVISIONING_PROFILE_BASE64` | the extension's `.mobileprovision`, base64'd |
| `APP_STORE_KEY_ID` | App Store Connect API key |
| `APP_STORE_ISSUER_ID` | App Store Connect API, above the key list |
| `APP_STORE_KEY_BASE64` | the App Store Connect `.p8`, base64'd |

These are the same seven the React Native release used; only the two profiles
need replacing, for the App Group.

And one **variable** (Secrets and variables → Actions → Variables), because it
is a public URL and not a secret:

| Variable | Value |
|---|---|
| `SLOPCODER_PUSH_RELAY` | the deployment that holds the APNs key, e.g. `https://slop.example.com` |

Leave it unset and the build is a working app with notifications off, which
the log says once at launch. It is deliberately not in the repository: a fork
shipping its own build points it at its own deployment by setting the variable,
not by editing a checked-in address.

## 4. Run it

**Actions → release → Run workflow**, on the branch you want built. There is no
version to pick and nothing to tag.

App Store Connect enforces uniqueness on the **build** number and on nothing
else, and that number is the workflow run number, which can never repeat. The
marketing version is simply the date the build was cut, so TestFlight reads
`2026.09.13 (35)` — true without anyone having decided it. Several builds in one
day are ordinary: they differ by the build number, which is what it is for.
Which commit a build is comes from the run that made it.

Processing takes ten minutes or so. **Internal testing** — up to 100 people on
your team — needs no review and is the fast path to your own phone. **External
testing** needs a Beta App Review, typically a day, and needs the app's
description and a contact email filled in first.

---

## Things that will bite

- **The `.p8` files download once.** Both of them. Losing one means revoking the
  key and issuing another.
- **Keep `distribution.key`.** It is the half of the certificate Apple never
  had, so it cannot be re-downloaded — only replaced, by revoking the
  certificate and making a new one. Back it up somewhere that is not this repo.
- **A sandbox push token is not a production one.** `App/Slopcoder.entitlements`
  says `development`, and `scripts/stamp.py --aps production` is what a release
  changes it to; the relay is told which environment a token came from, because
  production APNs rejects a sandbox token outright. A TestFlight build is
  *production*, even though it feels like a test.
- **A notification that shows "You have a new notification."** is the relay's
  placeholder: the extension did not run, or could not open the message. On a
  phone that has not been unlocked since it booted, that is expected. Otherwise
  it means the keys the app wrote are not the keys the extension found — almost
  always the App Group missing from one of the two profiles, or differing
  between the entitlement files, which `PackagingTests` pins.
- **An extension's version must equal its app's.** `scripts/stamp.py` writes the
  same two values into both plists; do not stamp one by hand.
- **`exportArchive` errors are usually the keychain, not the profile.** The
  workflow adds its throwaway keychain to the search list and extends its lock
  timeout to an hour for exactly this reason; if you change that step, those two
  lines are the ones to keep.
- **Signing is manual for Release** and deliberately so: CI installs one
  specific profile per bundle, and letting Xcode pick means it picks something
  else on a machine you cannot see.
