// The UI tests' server, tested where it can be: here. The walk below makes the
// requests the app makes on the path the UI tests take — through the same
// models and the same seam — so a screen that would come up empty under the
// stub fails on Linux first, with a reason, rather than on a Mac runner as a
// missing element.

import Foundation
import Testing
@testable import SlopcoderCore

private let never: SessionHub.Sleep = { _ in try await Task.sleep(nanoseconds: 60_000_000_000) }

@Suite struct StubModeTests {
    @Test func onlyTheLaunchArgumentTurnsItOn() {
        #expect(StubMode.requested(in: ["Slopcoder", "-SlopcoderStub", "1"]))
        #expect(StubMode.requested(in: ["Slopcoder", "-SlopcoderStub", "YES"]))
        #expect(StubMode.requested(in: ["Slopcoder", "-SlopcoderStub", "true"]))
        #expect(!StubMode.requested(in: ["Slopcoder"]))
        #expect(!StubMode.requested(in: ["Slopcoder", "-SlopcoderStub"]))
        #expect(!StubMode.requested(in: ["Slopcoder", "-SlopcoderStub", "0"]))
        #expect(!StubMode.requested(in: ["Slopcoder", "-SlopcoderStubX", "1"]))
        #expect(!StubMode.requested(in: ["Slopcoder", "1", "-SlopcoderStub"]))
    }

    @Test func itsServerCanNeverBeReached() {
        #expect(StubMode.credential.server.hasSuffix(".invalid"))
    }
}

@MainActor
@Suite struct StubServerTests {
    let server = StubServer()

    func seam() -> Seam { Seam(baseUrl: StubMode.credential.server, apiKey: StubMode.credential.apiKey, transport: server) }

    func hub() async throws -> SessionHub {
        let hub = SessionHub(.init(baseUrl: StubMode.credential.server, apiKey: "k"), connector: server, sleep: never, pingIntervalMs: 999_999)
        try await hub.start()
        return hub
    }

    /// Nothing on the walk may be a 404 or an error: either is a screen that
    /// says "could not load" in its screenshot.
    func everythingWasAnswered() {
        let failed = server.exchanges.filter { $0.status >= 400 }.map { "\($0.method) \($0.path) → \($0.status)" }
        #expect(failed.isEmpty, "\(failed)")
    }

    @Test func answersWhatItDoesNotKnowWithA404() async throws {
        for path in ["api/seam/nope", "api/other", "", "api/seam/sessions/no-such/scrollback?from=0&take=0"] {
            let response = try await server.send(HTTPRequest(method: "GET", url: "https://stub.invalid/\(path)", headers: [:]))
            #expect(response.status == 404, "\(path)")
        }
        #expect(try await seam().session("no-such") == nil)
    }

    @Test func theSessionsPageLoadsEverythingItShows() async throws {
        let hub = try await hub()
        let seam = seam()
        let model = SessionsModel(seam: { seam }, hub: { hub }, router: Router(), routineAlert: RoutineAlert(), zone: { "UTC" })
        await model.opened()

        #expect(model.sessions?.map(\.title) == [StubWorld.runningTitle, StubWorld.idleTitle])
        #expect(model.sessions?.map(\.status) == [.running, .idle])
        #expect(model.listState == .rows)
        #expect(model.strip?.upcoming.count == 1)
        #expect(model.models.count == 2)
        #expect(model.facets.map(\.name) == ["execute", "review"])
        #expect(model.owned.count == 1)
        #expect(model.ownedError == nil)
        everythingWasAnswered()
        model.close()
        hub.stop()
    }

    @Test func theIdleSessionOpensOnItsWholeTranscript() async throws {
        let hub = try await hub()
        let seam = seam()
        let model = SessionModel(sessionId: StubWorld.idleId, seam: { seam }, hub: { hub }, storeSleep: never)
        await model.open()

        #expect(model.title == StubWorld.idleTitle)
        #expect(model.running == false)
        #expect(model.store?.error == nil)
        let kinds = model.store?.items.map(\.kind) ?? []
        #expect(kinds == [.user, .tool, .text, .note])
        #expect(model.store?.items.last { $0.kind == .text }?.text?.contains(StubWorld.lastWords) == true)
        #expect(model.store?.items.first { $0.kind == .tool }?.tool?.running == false)
        #expect(model.dials.modelLabel == "Claude Opus 5.5")
        #expect(model.dials.thinkingLabel != "Auto")
        #expect(model.contextPercent == 21)

        // The session panel, opened from the title.
        await model.loadWorkspace()
        #expect(model.repoDetails?.first?.line == "Branch · fix-upload-race")
        await model.loadDirectory()
        #expect(model.directory?.count == 2)
        everythingWasAnswered()
        model.close()
        hub.stop()
    }

    @Test func aMessageSentToTheStubComesBackInTheTranscript() async throws {
        let hub = try await hub()
        let seam = seam()
        let model = SessionModel(sessionId: StubWorld.idleId, seam: { seam }, hub: { hub }, storeSleep: never)
        await model.open()
        let before = model.store?.items.count ?? 0

        model.draft = "Run it fifty times to be sure."
        await model.send()
        #expect(model.sendError == nil)
        let sent = try #require(server.exchanges.last { $0.path.hasSuffix("/start") })
        #expect(sent.method == "POST")
        #expect(sent.body?["prompt"] == "Run it fifty times to be sure.")

        // The delta reaches the open session over the hub, as a push would.
        #expect(await settled { (model.store?.items.count ?? 0) == before + 3 })
        let added = model.store?.items.suffix(3).map(\.kind)
        #expect(added == [.user, .text, .note])
        #expect(model.store?.items.last { $0.kind == .user }?.text == "Run it fifty times to be sure.")
        #expect(model.store?.items.last { $0.kind == .text }?.text == StubWorld.reply)
        everythingWasAnswered()
        model.close()
        hub.stop()
    }

    @Test func aRunningSessionIsSteeredAndAnIdleOneIsNot() async throws {
        let hub = try await hub()
        let seam = seam()
        let running = SessionModel(sessionId: StubWorld.runningId, seam: { seam }, hub: { hub }, storeSleep: never)
        await running.open()
        #expect(running.running)
        #expect(running.store?.live?.text.isEmpty == false)
        running.draft = "Keep SSE as a last resort."
        await running.send()
        #expect(server.exchanges.last?.path.hasSuffix("/steer") == true)
        #expect(server.exchanges.last?.status == 204)

        let steered = try await seam.steer(StubWorld.idleId, SteerRequest(prompt: "too late"))
        #expect(steered == false)
        running.close()
        hub.stop()
    }

    @Test func theSettingsHubAndItsPagesRead() async throws {
        let seam = seam()
        #expect(try await seam.serverProtocol()?.version == "stub")
        #expect(try await seam.connections().count == 1)
        #expect(try await seam.gitConnections().isEmpty)
        #expect(try await seam.nodes().isEmpty)
        #expect(try await seam.facets().count == 2)
        #expect(try await seam.skills().isEmpty)
        #expect(try await seam.channels().isEmpty)
        #expect(try await seam.gitIdentity().name == "Stub Person")
        #expect(try await seam.memories().isEmpty)
        everythingWasAnswered()
    }

    @Test func theOtherTabsHaveSomethingToShow() async throws {
        let seam = seam()
        #expect(try await seam.routineBoard(tz: "UTC").routines.map(\.name) == ["morning-digest"])
        #expect(try await seam.routine(StubWorld.routineId)?.routine.name == "morning-digest")
        #expect(try await seam.routines().count == 1)
        #expect(try await seam.artifacts().map(\.title) == [StubWorld.artifact.title])
        #expect(try await seam.artifact(StubWorld.artifactId)?.text?.isEmpty == false)
        everythingWasAnswered()
    }
}
