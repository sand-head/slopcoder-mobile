# Getting a build into TestFlight

The repo is set up so a tag does the work: `git tag v1.0.0 && git push --tags`
runs `.github/workflows/release.yml`, which archives, signs, and uploads. What
follows is the one-time setup on Apple's side that a workflow cannot do for you.

The app's bundle identifier is **`codes.sand.slopcoder`**. It appears in the
Xcode project, the URL type, the Keychain service both TypeScript and Swift
read, and the export options the workflow generates. `release-readiness.test.ts`
fails if any of those drift apart, so change it in one place and the suite tells
you the rest.

---

## 1. Apple Developer portal

**Team ID** — developer.apple.com → Membership. Ten characters. You will paste
it into a secret; it is not a password, but it is easier to keep in one place.

**App ID** — Certificates, IDs & Profiles → Identifiers → **+** → App IDs → App.

- Bundle ID: **Explicit**, `codes.sand.slopcoder`.
- Capabilities: tick **Push Notifications**. The release build's entitlement
  already says `aps-environment: production`, and an App ID without the
  capability makes the profile refuse to sign it.

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

**Those three algorithm flags are not decoration.** OpenSSL 3 defaults to
AES-256-CBC with an SHA-256 MAC, and macOS's `security import` — which is what
the runner uses — is unreliable with that combination. The 3DES/SHA-1 form is
what every Apple tool reads. The password you type at the export prompt becomes
`IOS_CERTIFICATE_PASSWORD`; the file becomes `IOS_CERTIFICATE_BASE64`.

**Provisioning profile** — Profiles → **+** → *App Store Connect* → pick the App
ID and the distribution certificate. Download the `.mobileprovision`. Its name
does not matter: the workflow reads it back out of the file with
`security cms -D`, so there is nothing to keep in sync.

**APNs key** — Keys → **+** → tick *Apple Push Notifications service*. Download
the `.p8`. No CSR and no OpenSSL here: Apple generates this one and hands you the
whole thing. **It is for the server, not for CI** — it fills slopcoder's
`Push:Apns:{KeyId,TeamId,BundleId,PrivateKey}`. Confusing it with the App Store
Connect key below is the single easiest mistake here; both are `.p8` files from
different pages, and neither can be downloaded twice.

## 2. App Store Connect

**App record** — My Apps → **+** → New App. Platform iOS, the bundle ID from the
list, a name, and an SKU (any stable string; `slopcoder-mobile` is fine).

**API key** — Users and Access → Integrations → App Store Connect API →
**+**, role *App Manager*. You get a **Key ID**, an **Issuer ID** (shown once at
the top of the page, shared by all keys), and a `.p8` that downloads **exactly
once**.

None of the above needs macOS. The only Mac in this pipeline is the
`macos-15` runner that builds the archive.

## 3. Repository secrets

GitHub → Settings → Secrets and variables → Actions. Base64 with
`base64 -i <file> | pbcopy` on macOS, `base64 -w0 <file>` on Linux.

| Secret | From |
|---|---|
| `APPLE_TEAM_ID` | Membership page |
| `IOS_CERTIFICATE_BASE64` | the `.p12`, base64'd |
| `IOS_CERTIFICATE_PASSWORD` | the password you set exporting it |
| `IOS_PROVISIONING_PROFILE_BASE64` | the `.mobileprovision`, base64'd |
| `APP_STORE_KEY_ID` | App Store Connect API key |
| `APP_STORE_ISSUER_ID` | App Store Connect API, above the key list |
| `APP_STORE_KEY_BASE64` | the App Store Connect `.p8`, base64'd |

The four `ANDROID_*` secrets are only for the Android job and are not needed to
reach TestFlight.

## 4. Tag it

```
git tag v1.0.0
git push --tags
```

The tag is the marketing version (`v1.0.0` → `1.0.0`); the **build** number is
the workflow run number, because App Store Connect refuses a build number it has
already accepted and would otherwise reject every upload after the first.

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
- **A sandbox push token is not a production one.** The debug and release
  entitlements differ on purpose (`entitlements.test.ts` pins it), and the server
  records which environment a token came from, because production APNs rejects a
  sandbox token outright. A TestFlight build is *production*, even though it
  feels like a test.
- **The first archive is the slow one.** Expect 20–30 minutes on a `macos-15`
  runner with a cold CocoaPods cache.
- **`exportArchive` errors are usually the keychain, not the profile.** The
  workflow adds its throwaway keychain to the search list and extends its lock
  timeout to an hour for exactly this reason; if you change that step, those two
  lines are the ones to keep.
- **Automatic signing is off for Release** and deliberately so: CI installs one
  specific profile, and letting Xcode pick means it picks something else on a
  machine you cannot see.
