// swift-tools-version: 6.0

import PackageDescription

// One package, three products.
//
// `SlopcoderCore` is Foundation-only: the wire contracts, the seam and hub
// clients, and everything the screens *decide*. It builds and tests on Linux
// with a stock toolchain and no Apple SDK.
//
// `Slopcoder` is the app and `NotificationService` its extension. xtool turns
// each library product into a bundle (see `xtool.yml`). Their sources are
// wrapped in `#if canImport(UIKit)`, so `swift build` on Linux compiles them to
// nothing instead of failing — the host cannot tell SwiftPM it is
// cross-compiling from inside the manifest.
// xtool's signer writes the code signature into the binary after linking, and
// needs room among the load commands to say where it is. The linker leaves
// none by default, and signing then fails with "Can't find free space of
// LoadCommands for CodeSignature".
let signable: [LinkerSetting] = [
    .unsafeFlags(["-Xlinker", "-headerpad", "-Xlinker", "0x4000"], .when(platforms: [.iOS])),
]

let package = Package(
    name: "Slopcoder",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "SlopcoderCore", targets: ["SlopcoderCore"]),
        .library(name: "Slopcoder", targets: ["Slopcoder"]),
        .library(name: "NotificationService", targets: ["NotificationService"]),
    ],
    targets: [
        .target(
            name: "SlopcoderCore",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .target(
            name: "SlopcoderPush",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .target(
            name: "Slopcoder",
            dependencies: ["SlopcoderCore", "SlopcoderPush"],
            resources: [.process("Resources")],
            swiftSettings: [.swiftLanguageMode(.v5)],
            linkerSettings: signable
        ),
        .target(
            name: "NotificationService",
            dependencies: ["SlopcoderPush"],
            swiftSettings: [.swiftLanguageMode(.v5)],
            // Nothing in an extension's binary refers to its principal class: the
            // system finds it by name at run time. Without -all_load the linker
            // sees an unreferenced object and leaves the whole class out.
            linkerSettings: signable + [.unsafeFlags(["-Xlinker", "-all_load"], .when(platforms: [.iOS]))]
        ),
        .testTarget(
            name: "SlopcoderCoreTests",
            dependencies: ["SlopcoderCore"],
            resources: [.copy("Fixtures")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
