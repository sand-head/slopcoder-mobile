import XCTest

/// The main path through the app, as a person would walk it, against the stub
/// server the app runs with when launched with `-SlopcoderStub 1`.
///
/// Each test launches the app afresh, so one that fails says which screen
/// went wrong without taking the rest with it. Every wait is generous, because
/// a hosted simulator can take seconds to draw what a phone draws at once, and
/// there is no fixed sleep anywhere. Each step keeps a screenshot, pass or
/// fail.
///
/// The names and sentences looked for here are the stub's, from
/// `Sources/SlopcoderCore/Stub/StubWorld.swift`; the two must change together.
@MainActor
final class SmokeTests: XCTestCase {
    private let timeout: TimeInterval = 60

    private enum Stub {
        static let idle = "Fix the flaky upload test"
        static let running = "Move the hub to long polling"
        static let lastWords = "The upload test passes ten runs in a row now."
        static let reply = "Noted. This is the stub server, so nothing ran."
    }

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-SlopcoderStub", "1"]
        app.launch()
        return app
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Anything on screen whose accessibility label contains `text`.
    private func labelled(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func text(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func require(_ element: XCUIElement, _ what: String, in app: XCUIApplication) {
        if !element.waitForExistence(timeout: timeout) {
            snap(app, "missing \(what)")
            XCTFail("Never saw \(what).")
        }
    }

    private func openIdleSession(_ app: XCUIApplication) {
        let row = app.buttons["\(Stub.idle), idle"]
        require(row, "the idle session in the list", in: app)
        row.tap()
        require(app.buttons["session.title"], "the session's title", in: app)
    }

    func testTheListShowsTheSessions() {
        let app = launch()
        require(app.buttons["\(Stub.idle), idle"], "the idle session", in: app)
        require(app.buttons["\(Stub.running), running"], "the running session", in: app)
        snap(app, "1 sessions")
    }

    /// A transcript that opens at its end shows its last words without being
    /// scrolled — the bug the collection view was built to fix.
    func testASessionOpensOnItsLastWordsAndSendsAMessage() {
        let app = launch()
        openIdleSession(app)

        let last = text(app, Stub.lastWords)
        require(last, "the agent's last words", in: app)
        let field = app.descendants(matching: .any)["composer.field"]
        require(field, "the composer", in: app)
        snap(app, "2 session")
        XCTAssertTrue(app.windows.firstMatch.frame.contains(last.frame), "The last words are off screen: \(last.frame)")
        XCTAssertLessThanOrEqual(last.frame.maxY, field.frame.minY + 1, "The last words are under the composer.")

        let message = "Run it fifty times to be sure."
        field.tap()
        field.typeText(message)
        app.buttons["composer.send"].tap()
        // The stub puts what it was sent into the transcript, and answers; a
        // row with these words exists only if the send reached it.
        require(text(app, message), "the message just sent", in: app)
        require(text(app, Stub.reply), "the stub's answer", in: app)
        snap(app, "3 sent")
    }

    func testTheTitleOpensTheSessionPanel() {
        let app = launch()
        openIdleSession(app)
        app.buttons["session.title"].tap()
        for row in ["Model", "Thinking", "Approvals"] {
            require(labelled(app, row), "the \(row) row", in: app)
        }
        snap(app, "4 session panel")
    }

    func testSettingsListsItsPagesAndOpensOne() {
        let app = launch()
        let tab = app.tabBars.buttons["Settings"].exists ? app.tabBars.buttons["Settings"] : app.buttons["Settings"].firstMatch
        require(tab, "the Settings tab", in: app)
        tab.tap()
        for row in ["Connections", "Git identity", "Memory", "API keys"] {
            require(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", row)).firstMatch, "the \(row) row", in: app)
        }
        snap(app, "5 settings")

        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Git identity")).firstMatch.tap()
        require(app.navigationBars["Git identity"], "the Git identity page", in: app)
        require(app.textFields.matching(NSPredicate(format: "value == %@", "Stub Person")).firstMatch, "the stored name", in: app)
        snap(app, "6 git identity")
    }
}
