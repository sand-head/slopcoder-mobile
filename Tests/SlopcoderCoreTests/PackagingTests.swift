import Foundation
import Testing
@testable import SlopcoderCore

/// The bundle's plists and xtool.yml are not compiled by anything, so a typo in
/// one is found on a phone, or by App Store Connect. These read them the way
/// the system will.
@Suite struct PackagingTests {
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    func plist(_ path: String) throws -> [String: Any] {
        let data = try Data(contentsOf: PackagingTests.root.appendingPathComponent(path))
        return try #require(try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
    }

    func text(_ path: String) throws -> String {
        try String(contentsOf: PackagingTests.root.appendingPathComponent(path), encoding: .utf8)
    }

    @Test func theAppAnswersItsUrlSchemeAndExplainsWhatItAsksFor() throws {
        let info = try plist("App/Info.plist")
        let types = try #require(info["CFBundleURLTypes"] as? [[String: Any]])
        #expect(types.first?["CFBundleURLSchemes"] as? [String] == ["slopcoder"])
        // Without these two strings iOS terminates the app when it asks.
        #expect((info["NSCameraUsageDescription"] as? String)?.isEmpty == false)
        #expect((info["NSPhotoLibraryUsageDescription"] as? String)?.isEmpty == false)
        #expect(info["ITSAppUsesNonExemptEncryption"] as? Bool == false)
        #expect(info["CFBundleDisplayName"] as? String == "slopcoder")
        // Restricting orientation, or asking for the full screen, gets the app
        // scaled instead of laid out on an iPhone Duo's inner display.
        let orientations = try #require(info["UISupportedInterfaceOrientations"] as? [String])
        // All four: App Store Connect rejects the upload of a resizable app that
        // omits any of them (error 90474), upside down included.
        #expect(Set(orientations) == [
            "UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown",
            "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight",
        ])
        #expect(info["UIRequiresFullScreen"] == nil)
        #expect(info["SlopcoderPushRelay"] is String)
        let transport = try #require(info["NSAppTransportSecurity"] as? [String: Any])
        #expect(transport["NSAllowsArbitraryLoads"] as? Bool == false)
        // Nothing substitutes build settings into this file.
        #expect(try !text("App/Info.plist").contains("$("))
    }

    @Test func theExtensionNamesTheClassTheSourcePins() throws {
        let info = try plist("App/NotificationService-Info.plist")
        let ext = try #require(info["NSExtension"] as? [String: Any])
        #expect(ext["NSExtensionPointIdentifier"] as? String == "com.apple.usernotifications.service")
        let principal = try #require(ext["NSExtensionPrincipalClass"] as? String)
        #expect(try text("Sources/NotificationService/NotificationService.swift").contains("@objc(\(principal))"))
        #expect(try !text("App/NotificationService-Info.plist").contains("$("))
    }

    /// App Store Connect refuses an extension whose version differs from its app's.
    @Test func theAppAndItsExtensionCarryOneVersion() throws {
        let app = try plist("App/Info.plist")
        let ext = try plist("App/NotificationService-Info.plist")
        #expect(app["CFBundleShortVersionString"] as? String == ext["CFBundleShortVersionString"] as? String)
        #expect(app["CFBundleVersion"] as? String == ext["CFBundleVersion"] as? String)
    }

    /// The extension reads the push keys the app wrote; that only works when
    /// both are in the App Group the Keychain item is filed under.
    @Test func bothBundlesShareTheGroupThePushKeysLiveIn() throws {
        let app = try plist("App/Slopcoder.entitlements")
        let ext = try plist("App/NotificationService.entitlements")
        let groups = try #require(app["com.apple.security.application-groups"] as? [String])
        #expect(groups == ext["com.apple.security.application-groups"] as? [String])
        let group = try #require(groups.first)
        #expect(try text("Sources/SlopcoderPush/Push.swift").contains("accessGroup = \"\(group)\""))
        #expect(app["aps-environment"] as? String == "development")
    }

    @Test func xtoolBuildsTheProductsThePackageDeclares() throws {
        let config = try text("xtool.yml")
        let package = try text("Package.swift")
        #expect(config.contains("bundleID: codes.sand.slopcoder\n"))
        #expect(config.contains("bundleID: codes.sand.slopcoder.NotificationService"))
        for product in ["Slopcoder", "NotificationService"] {
            #expect(config.contains("product: \(product)\n"))
            #expect(package.contains(".library(name: \"\(product)\""))
        }
        // Every file it points at exists.
        for line in config.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard let path = trimmed.split(separator: " ").last, trimmed.contains("App/") else { continue }
            guard !trimmed.hasPrefix("#") else { continue }
            #expect(FileManager.default.fileExists(atPath: PackagingTests.root.appendingPathComponent(String(path)).path), "\(path)")
        }
    }

    /// A release is built by Xcode from project.yml; everything else by xtool
    /// from xtool.yml. They describe the same two bundles or the release is a
    /// different app from the one that was tested.
    @Test func theXcodeProjectDescribesTheSameBundlesAsXtool() throws {
        let project = try text("project.yml")
        let package = try text("Package.swift")
        #expect(project.contains("PRODUCT_BUNDLE_IDENTIFIER: codes.sand.slopcoder\n"))
        #expect(project.contains("PRODUCT_BUNDLE_IDENTIFIER: codes.sand.slopcoder.NotificationService\n"))
        for product in ["Slopcoder", "NotificationService"] {
            #expect(project.contains("product: \(product)\n"))
            #expect(package.contains(".library(name: \"\(product)\""))
        }
        #expect(project.contains("CODE_SIGN_ENTITLEMENTS: App/Slopcoder.entitlements"))
        #expect(project.contains("CODE_SIGN_ENTITLEMENTS: App/NotificationService.entitlements"))
        #expect(project.contains("iOS: \"17.0\"") && package.contains(".iOS(.v17)"))
        for path in ["App/Xcode/empty.c", "App/Assets.xcassets/AppIcon.appiconset/Contents.json", "scripts/xcode-plists.py"] {
            #expect(FileManager.default.fileExists(atPath: PackagingTests.root.appendingPathComponent(path).path), "\(path)")
        }
    }

    /// The section of project.yml under `targets:` for one target.
    func target(_ name: String, in project: String) throws -> String {
        let start = try #require(project.range(of: "\n  \(name):\n"))
        let rest = project[start.upperBound...]
        let end = rest.range(of: "\n  [A-Za-z]", options: .regularExpression)?.lowerBound ?? rest.endIndex
        return String(rest[..<end])
    }

    /// The UI tests are a target of their own with a scheme of their own, and
    /// the scheme a release archives knows nothing of them.
    @Test func theUITestsAreTheirOwnTargetAndStayOutOfTheRelease() throws {
        let project = try text("project.yml")
        let tests = try target("SlopcoderUITests", in: project)
        #expect(tests.contains("type: bundle.ui-testing"))
        #expect(tests.contains("- path: App/UITests"))
        #expect(tests.contains("- target: SlopcoderApp"))
        #expect(tests.contains("TEST_TARGET_NAME: SlopcoderApp"))
        #expect(tests.contains("PRODUCT_BUNDLE_IDENTIFIER: codes.sand.slopcoder.UITests"))
        let schemes = try #require(project.range(of: "\nschemes:\n"))
        #expect(project[schemes.upperBound...].contains("\n  SlopcoderUITests:\n    build:\n"))
        #expect(project.contains("      config: Debug\n"))

        let app = try target("SlopcoderApp", in: project)
        #expect(app.contains("scheme: {}"))
        #expect(!app.contains("testTargets"))
        #expect(!app.contains("UITests"))
        #expect(try text(".github/workflows/release.yml").contains("-scheme SlopcoderApp -configuration Release"))
        // CI runs them through their own scheme, in the configuration with the stub.
        let ci = try text(".github/workflows/ci.yml")
        #expect(ci.contains("-scheme SlopcoderUITests -configuration Debug"))
        #expect(ci.contains("-retry-tests-on-failure"))

        let sources = try FileManager.default.contentsOfDirectory(atPath: PackagingTests.root.appendingPathComponent("App/UITests").path)
        #expect(sources.contains("SmokeTests.swift"))
        // Nothing in the package builds them: they are Xcode's alone.
        #expect(try !text("Package.swift").contains("UITests"))
    }

    /// The UI tests cannot be compiled here, so what they look for is held to
    /// what the stub serves.
    @Test func theUITestsLookForWhatTheStubServes() throws {
        let tests = try text("App/UITests/SmokeTests.swift")
        #expect(tests.contains("[\"\(StubMode.argument)\", \"1\"]"))
        #expect(StubMode.requested(in: ["app", StubMode.argument, "1"]))
        for line in [StubWorld.idleTitle, StubWorld.runningTitle, StubWorld.lastWords, StubWorld.reply] {
            #expect(tests.contains("\"\(line)\""), "\(line)")
        }
        #expect(tests.contains("\"Stub Person\""))
        #expect(StubWorld.idleEvents.last { $0.kind == "AssistantText" }?.payloadJson.contains(StubWorld.lastWords) == true)
        // The identifiers they find things by exist in the app.
        let composer = try text("Sources/Slopcoder/Screens/Composer.swift")
        let session = try text("Sources/Slopcoder/Screens/Session.swift")
        for identifier in ["composer.field", "composer.send"] {
            #expect(tests.contains("\"\(identifier)\""))
            #expect(composer.contains(".accessibilityIdentifier(\"\(identifier)\")"))
        }
        #expect(tests.contains("\"session.title\""))
        #expect(session.contains(".accessibilityIdentifier(\"session.title\")"))
    }

    /// Stub mode is a debug build's, and asks for nothing a release would carry.
    @Test func stubModeIsReachableOnlyFromADebugBuildsLaunchArgument() throws {
        let model = try text("Sources/Slopcoder/AppModel.swift")
        let gate = try #require(model.range(of: "#if DEBUG\n        let stub = StubMode.requested(in: ProcessInfo.processInfo.arguments) ? StubServer() : nil\n        #else\n        let stub: StubServer? = nil\n        #endif"))
        _ = gate
        #expect(model.components(separatedBy: "StubServer()").count == 2)
        for file in ["App/Info.plist", "App/Slopcoder.entitlements", "App/NotificationService.entitlements", "xtool.yml"] {
            #expect(try !text(file).lowercased().contains("stub"), "\(file)")
        }
    }
}
