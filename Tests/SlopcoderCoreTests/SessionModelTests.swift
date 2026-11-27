// The session screen's decisions, made without a screen: whether a message
// steers or starts a turn, what each dial sends, how photos are counted, and
// how far back the screen goes looking for the request that is holding the turn.

import Foundation
import Testing
@testable import SlopcoderCore

/// What a model asked the phone to feel, in order.
@MainActor
final class Felt {
    private(set) var names: [String] = []

    var feedback: Feedback {
        Feedback(
            confirm: { self.names.append("confirm") },
            refuse: { self.names.append("refuse") },
            success: { self.names.append("success") },
            error: { self.names.append("error") },
            select: { self.names.append("select") }
        )
    }
}

private let never: SessionHub.Sleep = { _ in try await Task.sleep(nanoseconds: 60_000_000_000) }

/// One event of the given kind, as scrollback carries it.
private func event(_ ordinal: Int, _ kind: String, _ payload: JSONValue) -> String {
    let inner = payload.serialized().replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    return #"{"ordinal":\#(ordinal),"kind":"\#(kind)","payloadJson":"\#(inner)"}"#
}

/// A session on a server, answering what the screen asks and recording it.
@MainActor
final class SessionServer {
    var status = 0
    var total = 2
    var pendingApprovals: [String] = []
    /// Ordinals that are approval requests rather than plain text.
    var approvals: [Int: String] = [:]
    var thinking = "null"
    /// Answers for anything else, by a fragment of the URL; the first match wins.
    var answers: [(String, Int, String)] = []
    let transport: RoutedTransport
    let felt = Felt()
    private(set) var hub: SessionHub!
    private(set) var connector = FakeConnector()

    init() {
        transport = RoutedTransport { _ in (204, "") }
    }

    var stateJSON: String {
        let pending = pendingApprovals.map { "\"\($0)\"" }.joined(separator: ",")
        return #"{"id":"s1","title":"Fix the build","status":\#(status),"nextOrdinal":\#(total),"thinkingLevel":\#(thinking),"approvalMode":0,"pendingApprovalIds":[\#(pending)],"repoNames":["slopcoder"]}"#
    }

    nonisolated static func events(_ range: Range<Int>, approvals: [Int: String]) -> String {
        "[" + range.map { ordinal in
            if let request = approvals[ordinal] {
                return event(ordinal, "ApprovalRequested", ["requestId": .string(request), "toolName": "Bash", "inputJson": "ls", "reason": ""])
            }
            return event(ordinal, "AssistantText", ["text": .string("t\(ordinal)")])
        }.joined(separator: ",") + "]"
    }

    /// Route every request, then start a hub that answers `Subscribe` with the state.
    func model() async throws -> SessionModel {
        let snapshot = (total: total, state: stateJSON, answers: answers, approvals: approvals)
        transport.route { request in
            for (fragment, status, body) in snapshot.answers where request.url.contains(fragment) { return (status, body) }
            if request.url.contains("/scrollback") {
                let query = parseQuery(String(request.url.split(separator: "?").last ?? ""))
                let from = Int(query["from"] ?? "0") ?? 0
                let take = Int(query["take"] ?? "0") ?? 0
                let end = take == 0 ? snapshot.total : min(snapshot.total, from + take)
                return (200, SessionServer.events(from..<max(from, end), approvals: snapshot.approvals))
            }
            if request.url.hasSuffix("/presence") { return (204, "") }
            if request.url.hasSuffix("/connections/candidates") { return (200, "[]") }
            if request.url.contains("/facets") { return (200, "[]") }
            if request.url.hasSuffix("/api/seam/sessions/s1") { return (200, snapshot.state) }
            return (204, "")
        }
        connector = FakeConnector()
        hub = SessionHub(.init(baseUrl: "https://s", apiKey: "k"), connector: connector, sleep: never, pingIntervalMs: 999_999)
        try await hub.start()
        connector.last.seed = snapshot.state
        let seam = Seam(baseUrl: "https://s", apiKey: "k", transport: transport)
        let hub = self.hub
        let model = SessionModel(sessionId: "s1", seam: { seam }, hub: { hub }, feedback: felt.feedback, storeSleep: never)
        await model.open()
        return model
    }

    func calls(_ fragment: String) -> [HTTPRequest] { transport.calls.filter { $0.url.contains(fragment) } }

    func body(_ fragment: String) -> JSONValue {
        calls(fragment).last?.body.flatMap { JSONValue.parse($0) } ?? .null
    }

    func finish(_ model: SessionModel) {
        model.close()
        hub.stop()
    }
}

private func image(_ key: String) -> PendingImage {
    PendingImage(key: key, mediaType: "image/png", base64Data: "QUJD")
}

@MainActor
@Suite struct SessionModelTests {
    @Test func opensOnTheSessionWithItsDialsAndLetsGoWhenClosed() async throws {
        let server = SessionServer()
        server.thinking = "3"
        let model = try await server.model()
        #expect(model.title == "Fix the build")
        #expect(model.rows.count == 2)
        #expect(model.turnOptions.thinking == .high)
        #expect(model.composerAction == "Send")
        #expect(model.composerPlaceholder == "Message Fix the build…")
        #expect(server.connector.last.targets == ["Subscribe"])

        model.close()
        #expect(model.store == nil)
        #expect(await eventually { server.connector.last.targets == ["Subscribe", "Unsubscribe"] })
        server.hub.stop()
    }

    @Test func anIdleSessionStartsATurnWithThePhotos() async throws {
        let server = SessionServer()
        let model = try await server.model()
        model.addImages([image("a")], problem: nil)
        model.draft = "  make it pass  "
        await model.send()

        #expect(server.calls("/steer").isEmpty)
        let body = server.body("/start")
        #expect(body["prompt"] == "make it pass")
        #expect(body["images"].array?.count == 1)
        #expect(model.draft == "")
        #expect(model.pendingImages.isEmpty)
        #expect(model.sendError == nil)
        #expect(server.felt.names == ["confirm"])
        server.finish(model)
    }

    @Test func aRunningSessionIsSteeredAndThePhotosWait() async throws {
        let server = SessionServer()
        server.status = 1
        let model = try await server.model()
        #expect(model.composerAction == "Steer")
        model.addImages([image("a")], problem: nil)
        model.draft = "also the docs"
        await model.send()

        #expect(server.body("/steer")["prompt"] == "also the docs")
        #expect(server.calls("/start").isEmpty)
        // Steering carries no photos; they stay for the next turn.
        #expect(model.pendingImages.map(\.key) == ["a"])
        server.finish(model)
    }

    @Test func aSteerTheTurnRefusedStartsOneInstead() async throws {
        let server = SessionServer()
        server.status = 1
        server.answers = [("/steer", 404, "")]
        let model = try await server.model()
        model.draft = "again"
        await model.send()
        #expect(server.calls("/steer").count == 1)
        #expect(server.body("/start")["prompt"] == "again")
        server.finish(model)
    }

    @Test func aRefusedMessageComesBackToTheComposer() async throws {
        let server = SessionServer()
        server.answers = [("/start", 404, "")]
        let model = try await server.model()
        model.draft = "hello"
        await model.send()
        #expect(model.draft == "hello")
        #expect(model.sendError == "The session did not accept the message.")
        #expect(server.felt.names == ["confirm", "error"])
        server.finish(model)
    }

    @Test func anOfflineSendSaysSoAndKeepsTheText() async throws {
        let server = SessionServer()
        server.answers = [("/start", -1, "")]
        let model = try await server.model()
        model.draft = "hello"
        await model.send()
        #expect(model.draft == "hello")
        #expect(model.sendError == describe(OfflineError()))
        server.finish(model)
    }

    @Test func aSlashCommandRunsThereAndOnlyATemplateSendsAPrompt() async throws {
        let server = SessionServer()
        server.answers = [("/slash/", 204, "")]
        let model = try await server.model()
        model.draft = "/compact"
        await model.send()
        #expect(server.body("/slash/")["input"] == "/compact")
        #expect(server.calls("/start").isEmpty)
        #expect(model.draft == "")

        server.answers = [("/slash/", 200, #"{"promptToSend":"review the diff"}"#)]
        let again = try await server.model()
        again.draft = "/review"
        await again.send()
        #expect(server.body("/start")["prompt"] == "review the diff")
        server.finish(model)
        again.close()
    }

    @Test func nothingIsSentForAnEmptyDraft() async throws {
        let server = SessionServer()
        let model = try await server.model()
        model.draft = "   \n "
        await model.send()
        #expect(server.calls("/start").isEmpty)
        #expect(server.felt.names.isEmpty)
        server.finish(model)
    }

    @Test func eachDialIsItsOwnCallAndShowsAtOnce() async throws {
        let server = SessionServer()
        let model = try await server.model()

        var next = model.turnOptions
        next.thinking = .low
        model.apply(next)
        #expect(model.turnOptions.thinking == .low)
        #expect(await settled { server.calls("/thinking").count == 1 })
        #expect(server.body("/thinking")["level"] == 1)

        next.approval = .always
        model.apply(next)
        #expect(await settled { server.calls("/approval-mode").count == 1 })
        #expect(server.body("/approval-mode")["mode"] == 2)
        #expect(server.body("/approval-mode")["useClassifier"] == true)

        next.facet = "reviewer"
        model.apply(next)
        #expect(await settled { server.calls("s1/facet").count == 1 })
        #expect(server.body("s1/facet")["facetName"] == "reviewer")

        // Each change sent only itself.
        #expect(server.calls("/thinking").count == 1)
        #expect(server.calls("/approval-mode").count == 1)
        #expect(server.calls("/thinking").allSatisfy { $0.method == "PUT" })
        server.finish(model)
    }

    @Test func aDialChangedBeforeTheSessionLoadedIsHeldButNotSent() {
        let model = SessionModel(sessionId: "s1", seam: { nil }, hub: { nil })
        model.apply(TurnOptions(thinking: .max))
        #expect(model.turnOptions.thinking == .max)
    }

    @Test func holdsAtMostFourPhotosAndSaysWhy() {
        let model = SessionModel(sessionId: "s1", seam: { nil }, hub: { nil })
        model.addImages([image("a"), image("b"), image("c")], problem: nil)
        model.addImages([image("d"), image("e")], problem: ImageRules.tooMany)
        #expect(model.pendingImages.map(\.key) == ["a", "b", "c", "d"])
        #expect(model.imageError == ImageRules.tooMany)
        model.removeImage("b")
        #expect(model.pendingImages.map(\.key) == ["a", "c", "d"])
        model.addImages([], problem: nil)
        #expect(model.imageError == nil)
    }

    @Test func stopIsFeltAndSent() async throws {
        let server = SessionServer()
        server.status = 1
        let model = try await server.model()
        model.stop()
        #expect(server.felt.names == ["refuse"])
        #expect(await settled { server.calls("/stop").count == 1 })
        #expect(server.calls("/stop")[0].method == "POST")
        server.finish(model)
    }

    @Test func approvingAndAnsweringReachTheServer() async throws {
        let server = SessionServer()
        let model = try await server.model()
        model.approve("r1", false)
        model.answer("q1", nil)
        #expect(server.felt.names == ["refuse", "confirm"])
        #expect(await settled { server.calls("/approvals").count == 1 && server.calls("/questions").count == 1 })
        #expect(server.body("/approvals") == ["requestId": "r1", "approved": false])
        #expect(server.body("/questions") == ["requestId": "q1", "answers": .null])
        server.finish(model)
    }

    @Test func addsARepositoryOrSaysWhyNot() async throws {
        let server = SessionServer()
        server.answers = [("/workspace/repos", 200, #"{"value":"That is not a git URL."}"#)]
        let model = try await server.model()
        model.repoUrl = "  "
        await model.addRepository()
        #expect(server.calls("/workspace/repos").isEmpty)

        model.repoUrl = " nonsense "
        await model.addRepository()
        #expect(server.body("/workspace/repos") == ["url": "nonsense"])
        #expect(model.repoMessage == "That is not a git URL.")
        #expect(model.repoUrl == " nonsense ")

        server.answers = [("/workspace/repos", 200, #"{"value":null}"#)]
        let again = try await server.model()
        again.repoUrl = "https://git.example/a/b.git"
        await again.addRepository()
        #expect(again.repoMessage == "Repository added.")
        #expect(again.repoUrl == "")

        server.answers = [("/workspace/repos", 404, "")]
        let gone = try await server.model()
        gone.repoUrl = "https://git.example/a/b.git"
        await gone.addRepository()
        #expect(gone.repoMessage == "That session is gone.")
        server.finish(model)
        again.close()
        gone.close()
    }

    @Test func readsTheWorkspaceIntoTheSubtitle() async throws {
        let server = SessionServer()
        server.answers = [("/workspace/changes", 200, #"[{"repo":"slopcoder","branch":"fix-build"},{"repo":"docs","sandboxDown":true}]"#)]
        let model = try await server.model()
        await model.loadWorkspace()
        #expect(model.repoDetails?.map(\.line) == ["Branch · fix-build", "Workspace unavailable"])
        #expect(model.subtitle == Captions.sessionSubtitle(["slopcoder"], branches: ["slopcoder": "fix-build"]))
        server.finish(model)
    }

    @Test func wordsEachStateOfARepository() {
        typealias Repo = SessionModel.WorkspaceRepo
        #expect(Repo(repo: "a", notARepository: true).line == "Not a repository")
        #expect(Repo(repo: "a", error: "permission denied").line == "permission denied")
        #expect(Repo(repo: "a", branch: "abc123", detached: true).line == "Detached · abc123")
        #expect(Repo(repo: "a").line == "Branch unknown")
    }

    @Test func findsTheRequestHoldingTheTurnInWhatIsLoaded() async throws {
        let server = SessionServer()
        server.approvals = [1: "a1"]
        server.pendingApprovals = ["a1"]
        let model = try await server.model()
        #expect(model.waiting)
        #expect(await model.findCurrentRequest() == "1:main")
        #expect(model.jumpNotice == nil)
        server.finish(model)
    }

    @Test func pagesBackForARequestAboveWhatIsLoaded() async throws {
        let server = SessionServer()
        server.total = 300
        server.approvals = [50: "a1"]
        server.pendingApprovals = ["a1"]
        let model = try await server.model()
        #expect(model.store?.items.first?.ordinal == 180)
        #expect(await model.findCurrentRequest() == "50:main")
        #expect(server.transport.urls.contains("https://s/api/seam/sessions/s1/scrollback?from=60&take=120"))
        #expect(model.jumpSearching == false)
        server.finish(model)
    }

    @Test func saysWhenTheRequestIsNowhereInTheTranscript() async throws {
        let server = SessionServer()
        server.pendingApprovals = ["elsewhere"]
        let model = try await server.model()
        #expect(await model.findCurrentRequest() == nil)
        #expect(model.jumpNotice == "Current request was not found in the available transcript.")
        model.approvalsChanged()
        #expect(model.jumpNotice == nil)

        // With history to go through, it goes through all of it first.
        server.total = 200
        let longer = try await server.model()
        #expect(await longer.findCurrentRequest() == nil)
        #expect(longer.jumpNotice == "Current request was not found in the available transcript.")
        server.finish(model)
        longer.close()
    }

    @Test func givesUpAfterThreePagesAndSaysHowToGoOn() async throws {
        let server = SessionServer()
        server.total = 600
        server.pendingApprovals = ["deep"]
        let model = try await server.model()
        #expect(await model.findCurrentRequest() == nil)
        #expect(model.jumpNotice == "Request not found in three earlier pages. Tap status to search further.")
        server.finish(model)
    }
}
