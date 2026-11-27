// The sessions page's decisions: what the list says, when recall asks the
// server, the launcher's two calls, and what rename and delete do to the list
// and to whatever is open beside it.

import Foundation
import Testing
@testable import SlopcoderCore

private let never: SessionHub.Sleep = { _ in try await Task.sleep(nanoseconds: 60_000_000_000) }

private func summary(_ id: String, _ title: String, running: Bool = false) -> String {
    #"{"id":"\#(id)","title":"\#(title)","model":"m","autoRoute":true,"status":\#(running ? 1 : 0),"createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}"#
}

private let twoSessions = "[" + summary("a", "Fix the build", running: true) + "," + summary("b", "Write the docs") + "]"

/// A server for the list, routed by path, with per-test answers ahead of the defaults.
@MainActor
final class ListServer {
    /// Read on every request, so a test may change them between calls.
    private let answerBox = Locked<[Answer]>([])
    struct Answer: Sendable {
        var fragment: String
        var status: Int
        var body: String
    }
    var answers: [(String, Int, String)] {
        get { answerBox.withLock { $0.map { ($0.fragment, $0.status, $0.body) } } }
        set { answerBox.withLock { $0 = newValue.map { Answer(fragment: $0.0, status: $0.1, body: $0.2) } } }
    }
    var sessions = twoSessions
    let transport: RoutedTransport
    let felt = Felt()
    let router = Router()
    let alert = RoutineAlert()
    private(set) var keyboardDismissals = 0

    init() { transport = RoutedTransport { _ in (204, "") } }

    func model(hub: SessionHub? = nil) -> SessionsModel {
        let answers = answerBox
        let sessions = self.sessions
        transport.route { request in
            for answer in answers.withLock({ $0 }) where request.url.contains(answer.fragment) { return (answer.status, answer.body) }
            if request.url.hasSuffix("/api/seam/sessions/"), request.method == "GET" { return (200, sessions) }
            if request.url.contains("/automations/status") { return (200, #"{"anyRoutines":true,"anyFailed":true,"upcoming":[]}"#) }
            if request.url.contains("/candidates") || request.url.contains("/facets") || request.url.contains("/nodes") { return (200, "[]") }
            if request.url.contains("recent-repos") { return (200, "[]") }
            return (204, "")
        }
        let seam = Seam(baseUrl: "https://s", apiKey: "k", transport: transport)
        return SessionsModel(
            seam: { seam }, hub: { hub }, router: router, routineAlert: alert, feedback: felt.feedback,
            dismissKeyboard: { self.keyboardDismissals += 1 }, debounce: { _ in }, zone: { "Europe/London" }
        )
    }

    func calls(_ fragment: String, _ method: String? = nil) -> [HTTPRequest] {
        transport.calls.filter { $0.url.contains(fragment) && (method == nil || $0.method == method) }
    }

    func body(_ fragment: String, _ method: String? = nil) -> JSONValue {
        calls(fragment, method).last?.body.flatMap { JSONValue.parse($0) } ?? .null
    }

    var listReads: Int { transport.calls.filter { $0.url.hasSuffix("/api/seam/sessions/") && $0.method == "GET" }.count }
}

@MainActor
@Suite struct SessionsModelTests {
    @Test func listsTheSessionsAndRaisesTheRoutinesBadge() async {
        let server = ListServer()
        let model = server.model()
        #expect(model.listState == .loading)
        await model.load()
        #expect(model.sessions?.map(\.id) == ["a", "b"])
        #expect(model.listState == .rows)
        #expect(model.strip?.anyFailed == true)
        #expect(server.alert.anyFailed)
        #expect(server.transport.urls.contains { $0.contains("/automations/status") && $0.contains("Europe") })
    }

    @Test func saysWhyTheListIsMissing() async {
        let server = ListServer()
        server.answers = [("/api/seam/sessions/", 500, "")]
        let model = server.model()
        await model.load()
        #expect(model.sessions == nil)
        #expect(model.error != nil)
        #expect(model.listState == .rows)

        let empty = ListServer()
        empty.sessions = "[]"
        let none = empty.model()
        await none.load()
        #expect(none.listState == .empty)
    }

    @Test func filtersByTitleAndByRunning() async {
        let server = ListServer()
        let model = server.model()
        await model.load()
        model.query = "  docs "
        #expect(model.searched.map(\.id) == ["b"])
        #expect(model.strip == nil)
        model.query = ""
        model.filter = .running
        #expect(model.visible.map(\.id) == ["a"])
    }

    @Test func recallsWhatWasSaidOnlyWhenNoTitleMatches() async {
        let server = ListServer()
        server.answers = [("/session-search", 200, #"[{"sessionId":"x","sessionTitle":"Old","when":"2026-10-01T00:00:00Z","kind":"text","snippet":"flaky test"}]"#)]
        let model = server.model()
        await model.load()

        // A title matches: the server is not asked.
        model.query = "build"
        await model.recallIfNeeded()
        #expect(server.calls("/session-search").isEmpty)
        #expect(model.recall == nil)

        // Too short to be worth a search.
        model.query = "z"
        await model.recallIfNeeded()
        #expect(server.calls("/session-search").isEmpty)

        model.query = "flaky"
        #expect(model.listState == .noMatch("flaky"))
        await model.recallIfNeeded()
        #expect(server.calls("/session-search").count == 1)
        #expect(model.shownRecall?.hits.map(\.sessionId) == ["x"])
        #expect(model.recallBusy == false)

        // An answer to an older query is not shown against a new one.
        model.query = "flakier"
        #expect(model.shownRecall == nil)
    }

    @Test func startsASessionByCreatingThenRunningIt() async {
        let server = ListServer()
        server.answers = [("/api/seam/sessions/", 200, #"{"id":"new1"}"#)]
        let model = server.model()
        model.prompt = "  fix the flaky test \n"
        model.options = TurnOptions(thinking: .high, approval: .always, facet: "reviewer")
        model.attach(repos: ["https://git.example/a/b.git"], nodes: [])
        model.addImages([PendingImage(key: "p", mediaType: "image/png", base64Data: "QUJD")], problem: nil)
        await model.start()

        let paths = server.transport.calls.map { "\($0.method) \($0.url.replacingOccurrences(of: "https://s/", with: ""))" }
        #expect(paths == [
            "POST api/seam/sessions/",
            "PUT api/seam/sessions/new1/approval-mode",
            "POST api/seam/sessions/new1/start",
        ])
        let create = server.transport.calls[0].body.flatMap { JSONValue.parse($0) } ?? .null
        #expect(create["initialPrompt"] == "fix the flaky test")
        #expect(create["repoUrls"] == ["https://git.example/a/b.git"])
        #expect(create["facet"] == "reviewer")
        #expect(create["thinkingLevel"] == 3)
        #expect(create["nodeIds"] == .null)
        #expect(server.body("/approval-mode")["mode"] == 2)
        #expect(server.body("/start")["prompt"] == "fix the flaky test")
        #expect(server.body("/start")["images"].array?.count == 1)

        #expect(model.prompt == "")
        #expect(model.pendingImages.isEmpty)
        #expect(model.repos.isEmpty)
        #expect(server.router.sessions == [.session(id: "new1")])
        #expect(server.keyboardDismissals == 1)
        #expect(server.felt.names == ["confirm"])
    }

    /// Creating is one call and starting another. A start that failed after
    /// the create must not leave the server a second session on the next tap.
    @Test func aStartThatFailedAfterTheCreateReusesTheSessionOnTheNextTap() async {
        let server = ListServer()
        server.answers = [("/approval-mode", 500, ""), ("/api/seam/sessions/", 200, #"{"id":"new1"}"#)]
        let model = server.model()
        model.prompt = "go"
        model.options = TurnOptions(approval: .always)
        await model.start()
        #expect(model.startError != nil)
        #expect(server.calls("/start").isEmpty)

        server.answers = [("/api/seam/sessions/", 200, #"{"id":"new2"}"#)]
        await model.start()
        let paths = server.transport.calls.map { "\($0.method) \($0.url.replacingOccurrences(of: "https://s/", with: ""))" }
        #expect(paths == [
            "POST api/seam/sessions/",
            "PUT api/seam/sessions/new1/approval-mode",
            "PUT api/seam/sessions/new1/approval-mode",
            "POST api/seam/sessions/new1/start",
        ])
        #expect(model.startError == nil)
        #expect(server.router.sessions == [.session(id: "new1")])
    }

    @Test func aChangedRequestDropsTheHalfStartedSessionBeforeMakingANewOne() async {
        let server = ListServer()
        server.answers = [("/start", -1, ""), ("/api/seam/sessions/", 200, #"{"id":"new1"}"#)]
        let model = server.model()
        model.prompt = "go"
        await model.start()
        #expect(model.startError == describe(OfflineError()))
        #expect(model.prompt == "go")

        // The facet rode on the create, so the session made for "go" is not this one.
        model.options.facet = "review"
        server.answers = [("/api/seam/sessions/", 200, #"{"id":"new2"}"#)]
        await model.start()
        let paths = server.transport.calls.map { "\($0.method) \($0.url.replacingOccurrences(of: "https://s/", with: ""))" }
        #expect(paths == [
            "POST api/seam/sessions/",
            "POST api/seam/sessions/new1/start",
            "DELETE api/seam/sessions/new1",
            "POST api/seam/sessions/",
            "POST api/seam/sessions/new2/start",
        ])
        #expect(server.router.sessions == [.session(id: "new2")])

        // Once started, it is a session like any other, and the next prompt makes its own.
        model.prompt = "again"
        server.answers = [("/api/seam/sessions/", 200, #"{"id":"new3"}"#)]
        await model.start()
        #expect(server.calls("new2", "DELETE").isEmpty)
        #expect(server.router.sessions == [.session(id: "new3")])
    }

    @Test func theDefaultApprovalModeNeedsNoCallOfItsOwn() async {
        let server = ListServer()
        server.answers = [("/api/seam/sessions/", 200, #"{"id":"new1"}"#)]
        let model = server.model()
        model.prompt = "go"
        await model.start()
        #expect(server.calls("/approval-mode").isEmpty)
        #expect(server.calls("/start").count == 1)
    }

    @Test func aCreateWithNoIdSaysTheModelIsGoneAndKeepsThePrompt() async {
        let server = ListServer()
        server.answers = [("/api/seam/sessions/", 200, #"{"id":null}"#)]
        let model = server.model()
        model.prompt = "go"
        await model.start()
        #expect(model.startError == "That model selection is no longer available.")
        #expect(server.calls("/start").isEmpty)
        #expect(model.prompt == "go")
        #expect(server.router.sessions.isEmpty)
        #expect(server.felt.names == ["error"])
        #expect(model.starting == false)
    }

    @Test func anOfflineStartSaysSo() async {
        let server = ListServer()
        server.answers = [("/api/seam/sessions/", -1, "")]
        let model = server.model()
        model.prompt = "go"
        await model.start()
        #expect(model.startError == describe(OfflineError()))
        #expect(model.prompt == "go")
    }

    @Test func nothingStartsFromAnEmptyPrompt() async {
        let server = ListServer()
        let model = server.model()
        model.prompt = " \n"
        await model.start()
        #expect(server.transport.calls.isEmpty)
    }

    @Test func renamesWithTheTrimmedNameAndRereadsTheList() async throws {
        let server = ListServer()
        let model = server.model()
        await model.load()
        let session = try #require(model.sessions?.first)

        await model.rename(session, to: "  Fix the build ")
        #expect(server.calls("/name").isEmpty)
        await model.rename(session, to: "   ")
        #expect(server.calls("/name").isEmpty)

        await model.rename(session, to: " Fix CI ")
        #expect(server.calls("/name").first?.method == "PUT")
        #expect(server.body("/name") == ["name": "Fix CI"])
        #expect(server.listReads == 2)
    }

    @Test func aRenameThatFailedSaysSoAndKeepsTheOldName() async throws {
        let server = ListServer()
        server.answers = [("/name", -1, "")]
        let model = server.model()
        await model.load()
        let session = try #require(model.sessions?.first)
        await model.rename(session, to: "Fix CI")

        #expect(model.actionError == "Could not reach the server, so “Fix the build” was not renamed. Try again once you are back online.")
        #expect(model.sessions?.first?.title == "Fix the build")
        #expect(server.felt.names == ["error"])
        #expect(server.listReads == 1)

        server.answers = [("/name", 500, "")]
        await model.rename(session, to: "Fix CI")
        #expect(model.actionError == "The server could not rename “Fix the build” just now (it answered 500). Try again in a moment.")

        server.answers = []
        await model.rename(session, to: "Fix CI")
        #expect(model.actionError == nil)
        #expect(server.listReads == 2)
    }

    @Test func aRunningSessionIsNotDeletedAndThePageSaysSo() async throws {
        let server = ListServer()
        server.answers = [("/api/seam/sessions/a", 200, #"{"result":2}"#)]
        let model = server.model()
        await model.load()
        server.router.select(.session(id: "a"))
        let session = try #require(model.sessions?.first)

        await model.remove(session)
        #expect(model.stillRunning)
        #expect(server.felt.names == ["error"])
        #expect(server.router.sessions == [.session(id: "a")])
        #expect(server.listReads == 1)
    }

    @Test func deletingTheOpenSessionClosesItAndRereadsTheList() async throws {
        let server = ListServer()
        server.answers = [("/api/seam/sessions/a", 200, #"{"result":0}"#)]
        let model = server.model()
        await model.load()
        server.router.select(.session(id: "a"))
        let session = try #require(model.sessions?.first)

        await model.remove(session)
        #expect(server.calls("/api/seam/sessions/a", "DELETE").count == 1)
        #expect(model.stillRunning == false)
        #expect(server.felt.names == ["refuse"])
        #expect(server.router.sessions.isEmpty)
        #expect(server.listReads == 2)
    }

    @Test func aDeleteThatNeverReachedTheServerSaysSoAndChangesNothing() async throws {
        let server = ListServer()
        server.answers = [("/api/seam/sessions/a", -1, "")]
        let model = server.model()
        await model.load()
        server.router.select(.session(id: "a"))
        await model.remove(try #require(model.sessions?.first))

        #expect(model.actionError == "Could not reach the server, so “Fix the build” was not deleted. Try again once you are back online.")
        #expect(server.felt.names == ["error"])
        #expect(server.router.sessions == [.session(id: "a")])
        #expect(model.stillRunning == false)
        #expect(server.listReads == 1)
    }

    @Test func aDeleteTheServerRefusedSaysSoAndChangesNothing() async throws {
        let server = ListServer()
        server.answers = [("/api/seam/sessions/a", 500, "")]
        let model = server.model()
        await model.load()
        server.router.select(.session(id: "a"))
        await model.remove(try #require(model.sessions?.first))

        #expect(model.actionError == "The server could not delete “Fix the build” just now (it answered 500). Try again in a moment.")
        #expect(server.felt.names == ["error"])
        #expect(server.router.sessions == [.session(id: "a")])

        // The next delete that lands clears it.
        server.answers = [("/api/seam/sessions/a", 200, #"{"result":0}"#)]
        let again = server.model()
        await again.load()
        await again.remove(try #require(again.sessions?.first))
        #expect(again.actionError == nil)
    }

    @Test func deletingAnotherSessionLeavesTheOpenOneOpen() async throws {
        let server = ListServer()
        server.answers = [("/api/seam/sessions/b", 200, #"{"result":0}"#)]
        let model = server.model()
        await model.load()
        server.router.select(.session(id: "a"))
        await model.remove(try #require(model.sessions?.last))
        #expect(server.router.sessions == [.session(id: "a")])
    }

    @Test func rereadsTheListWhenTheRegistryChangesUntilThePageGoes() async throws {
        let server = ListServer()
        let connector = FakeConnector()
        let hub = SessionHub(.init(baseUrl: "https://s", apiKey: "k"), connector: connector, sleep: never, pingIntervalMs: 999_999)
        try await hub.start()
        let model = server.model(hub: hub)
        await model.opened()
        #expect(server.listReads == 1)
        #expect(model.ownedLoaded)

        connector.last.push(#"{"type":1,"target":"RegistryChanged","arguments":[]}"# + "\u{1e}")
        #expect(await settled { server.listReads == 2 })

        model.close()
        connector.last.push(#"{"type":1,"target":"RegistryChanged","arguments":[]}"# + "\u{1e}")
        try await Task.sleep(nanoseconds: 40_000_000)
        #expect(server.listReads == 2)

        // Coming back listens again, once.
        await model.opened()
        #expect(server.listReads == 3)
        connector.last.push(#"{"type":1,"target":"RegistryChanged","arguments":[]}"# + "\u{1e}")
        #expect(await settled { server.listReads == 4 })
        model.close()
        hub.stop()
    }

    @Test func saysWhenSomeForgesCouldNotListRepositories() async {
        let server = ListServer()
        server.answers = [("/git/repos", 200, #"{"repos":[],"errors":["github: 401"]}"#)]
        let model = server.model()
        await model.loadCatalogs()
        #expect(model.ownedError == "Couldn't list repositories — github: 401")
        #expect(model.ownedLoaded)
    }
}
