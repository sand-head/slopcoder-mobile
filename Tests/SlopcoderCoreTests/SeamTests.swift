// The HTTP contract's sharp edges: the header that is not optional, and the
// status codes that mean something other than "it broke".

import Foundation
import Testing
@testable import SlopcoderCore

@Suite struct SeamTests {
    func seam(_ transport: FakeTransport, base: String = "https://s") -> Seam {
        Seam(baseUrl: base, apiKey: "slop_k", transport: transport)
    }

    /// The phone is routinely newer than its server. One from before Claude plans
    /// were listed has no plan-quotas route and answers 404; it still has the
    /// Codex one, and the Usage page must not go blank against it.
    @Test func listsPlanQuotasAndFallsBackToTheCodexOnlyRoute() async throws {
        let row = #"{"connectionId":"c","connectionName":"plan","windows":[],"isStale":true"#
        let transport = FakeTransport(.json(200, "[\(row),\"kind\":3,\"canRefresh\":false}]"))
        let seam = seam(transport, base: "https://slop.example.com")

        let listed = try await seam.planQuotas(refresh: true)
        #expect(listed.count == 1)
        #expect(listed[0].kind.rawValue == 3)
        #expect(listed[0].canRefresh == false)
        #expect(transport.url(0) == "https://slop.example.com/api/seam/usage/plan-quotas?refresh=true")

        transport.reset(.json(404), .json(200, "[\(row)}]"))
        let legacy = try await seam.planQuotas(refresh: false)
        #expect(legacy.count == 1)
        #expect(legacy[0].kind == ProviderKind.openAICodex)
        #expect(legacy[0].kind.rawValue == 2)
        #expect(legacy[0].canRefresh == true)
        #expect(legacy[0].connectionId == "c")
        #expect(transport.url(1) == "https://slop.example.com/api/seam/usage/codex-quotas?refresh=false")
    }

    @Test func sendsTheHeaderSameOriginFilterDemandsOnAMutation() async throws {
        let transport = FakeTransport(.json(204))
        _ = try await seam(transport).stop("abc")
        #expect(transport.headers()[clientHeader] == "1")
        #expect(transport.headers()["Authorization"] == "Bearer slop_k")
        #expect(transport.method() == "POST")
    }

    /// An artifact's bytes do not come from the seam: a PDF has no business being
    /// base64 in a JSON envelope. Two URLs, and the difference is who can open
    /// them — the raw route wants the bearer key, the share link wants nothing.
    @Test func pointsAtTheRawRouteForBytesAndTheShareRouteForALink() {
        let seam = seam(FakeTransport(), base: "https://slop.example.com")
        #expect(seam.artifactRawUrl("a-1") == "https://slop.example.com/artifacts/a-1/raw")
        #expect(seam.shareUrl("a/tok") == "https://slop.example.com/a/tok")
    }

    @Test func mintsOrRevokesAShareLink() async throws {
        let transport = FakeTransport(.json(200, #"{"id":"a-1","shareToken":"tok","shared":true,"sharePath":"a/tok"}"#))
        let updated = try await seam(transport, base: "https://slop.example.com").shareArtifact("a-1", shared: true)
        #expect(transport.url(0) == "https://slop.example.com/api/seam/artifacts/a-1/share")
        #expect(transport.method() == "POST")
        #expect(transport.body() == ["shared": true])
        #expect(updated?.sharePath == "a/tok")
    }

    /// The slash group is mapped at `/slash/` — a request without that trailing
    /// slash is a 404, which the transport reads as "no such session" and the
    /// composer as "no commands".
    @Test func listsCommandsOffTheSlashGroupsOwnPath() async throws {
        let transport = FakeTransport(.json(200, #"[{"name":"compact","help":"summarize older history"}]"#))
        let commands = try await seam(transport).slashCommands("s-1")
        #expect(transport.url(0) == "https://s/api/seam/sessions/s-1/slash/")
        #expect(commands.map(\.name) == ["compact"])
    }

    @Test func readsACommandThatProducedNoPromptAsNothingToSend() async throws {
        let transport = FakeTransport(.json(200, #"{"promptToSend":"review the diff"}"#))
        let seam = seam(transport)
        let expanded = try await seam.runSlashCommand("s-1", input: "/review")
        #expect(transport.url(0) == "https://s/api/seam/sessions/s-1/slash/")
        #expect(transport.body() == ["input": "/review"])
        #expect(expanded?.promptToSend == "review the diff")

        transport.reset(.json(204))
        #expect(try await seam.runSlashCommand("s-1", input: "/compact") == nil)
        transport.reset(.json(404))
        #expect(try await seam.runSlashCommand("s-1", input: "/compact") == nil)
    }

    @Test func trimsATrailingSlashOffTheServer() async throws {
        let transport = FakeTransport(.json(200, "[]"))
        _ = try await seam(transport, base: "https://slop.example.com/").sessions()
        #expect(transport.url(0) == "https://slop.example.com/api/seam/sessions/")
    }

    @Test func readsARepositorySearchAsTheBareArrayTheEndpointReturns() async throws {
        let transport = FakeTransport(.json(200, #"[{"fullName":"a/b","cloneUrl":"https://x/a/b.git","kind":1,"private":false}]"#))
        let rows = try await seam(transport).searchRepos("b")
        #expect(rows == [GitRepoRow(fullName: "a/b", cloneUrl: "https://x/a/b.git", kind: .forgejo, private: false)])
        #expect(transport.url(0) == "https://s/api/seam/git/repos/search?q=b")
    }

    @Test func readsARepositoryListingAsAnObjectErrorsAndAll() async throws {
        let transport = FakeTransport(.json(200, #"{"repos":[],"errors":["github: 503"]}"#))
        #expect(try await seam(transport).repos() == GitRepoListing(repos: [], errors: ["github: 503"]))
    }

    @Test func readsA404AsNilNotAsAFailure() async throws {
        #expect(try await seam(FakeTransport(.json(404))).session("gone") == nil)
    }

    /// The server's record is `ImageAttachment(MediaType, Base64Data)`, so the
    /// JSON says `base64Data`. A wrong name here is an image the model never sees.
    @Test func sendsImagesInlineUnderTheNamesTheServerReads() async throws {
        let transport = FakeTransport(.json(200))
        _ = try await seam(transport).start("abc", StartSessionRequest(
            prompt: "what is this",
            selection: .autoRoute,
            images: [ImageAttachment(mediaType: "image/jpeg", base64Data: "QUJD")]
        ))
        #expect(transport.url(0) == "https://s/api/seam/sessions/abc/start")
        #expect(transport.body()["images"] == [["mediaType": "image/jpeg", "base64Data": "QUJD"]])
        #expect(transport.body()["selection"]["auto"] == true)
    }

    @Test func readsA404OnACommandAsNoLongerApplicable() async throws {
        // Steering a turn that already ended, or answering a resolved approval.
        #expect(try await seam(FakeTransport(.json(404))).steer("abc", SteerRequest(prompt: "x")) == false)
    }

    /// A save answers with a result rather than a TextResult, because it may
    /// mint a webhook secret and this is the one moment it is readable.
    @Test func readsACreateAsTheSaveResultItIs() async throws {
        let transport = FakeTransport(.json(200, #"{"error":null,"webhooks":[{"automationId":"a","triggerId":"t","secret":"s3"}]}"#))
        let result = try await seam(transport).createRoutine(AutomationDraft(name: "x", prompt: "y"))
        #expect(result.error == nil)
        #expect(result.webhooks.first?.secret == "s3")
        #expect(transport.url(0) == "https://s/api/seam/automations/")
        #expect(transport.method() == "POST")
        #expect(transport.body()["name"] == "x")
        #expect(transport.body()["triggers"] == [])
    }

    @Test func wordsA404OnAnUpdateRatherThanSavingIntoTheVoid() async throws {
        let transport = FakeTransport(.json(404))
        let result = try await seam(transport).updateRoutine("gone", AutomationDraft())
        #expect(result == AutomationSaveResult(error: "That routine is gone.", webhooks: []))
        #expect(transport.method() == "PUT")
    }

    @Test func sendsAScheduleToBeReadInThePhoneZone() async throws {
        let transport = FakeTransport(.json(200, #"{"ok":true,"cron":"0 7 * * 1-5"}"#))
        let parsed = try await seam(transport).parseSchedule("every weekday at 7am", timeZoneId: "Europe/Berlin")
        #expect(parsed.ok)
        #expect(transport.url(0) == "https://s/api/seam/automations/schedule")
        #expect(transport.body() == ["text": "every weekday at 7am", "timeZoneId": "Europe/Berlin"])
    }

    @Test func sendsADescriptionToBeDrafted() async throws {
        let transport = FakeTransport(.json(200, #"{"ok":false,"error":"no model"}"#))
        let result = try await seam(transport).draftRoutine("check the deploy each morning")
        #expect(result.ok == false)
        #expect(transport.body() == ["description": "check the deploy each morning", "timeZoneId": .null])
    }

    @Test func rotatesAWebhookSecretAtTheTriggerNotTheRoutine() async throws {
        let transport = FakeTransport(.json(200, #"{"error":null,"webhooks":[]}"#))
        _ = try await seam(transport).rotateWebhookSecret("a", triggerId: "t")
        #expect(transport.url(0) == "https://s/api/seam/automations/a/webhooks/t/rotate")
    }

    @Test func signsOutOnA401RatherThanRetrying() async throws {
        let signedOut = Recorder<Bool>()
        let seam = Seam(baseUrl: "https://s", apiKey: "slop_dead", transport: FakeTransport(.json(401)), onSignedOut: { signedOut.add(true) })
        await #expect(throws: SignedOutError.self) { try await seam.sessions() }
        #expect(signedOut.values == [true])
    }

    // MARK: reachability

    @Test func reportsADeadServerAsUnreachableAndSaysSomethingActionable() async throws {
        let seam = seam(FakeTransport(.fail(URLError(.cannotFindHost))))
        do {
            _ = try await seam.sessions()
            Issue.record("expected a throw")
        } catch {
            #expect(error is OfflineError)
            #expect(describe(error).lowercased().contains("could not reach"))
        }
    }

    @Test func tellsTheAppWhenItGoesDownAndWhenItComesBack() async throws {
        let seen = Recorder<Bool>()
        let transport = FakeTransport(.fail(URLError(.notConnectedToInternet)))
        let seam = Seam(baseUrl: "https://s", apiKey: "slop_k", transport: transport, onReachable: { seen.add($0) })
        _ = try? await seam.sessions()
        transport.reset(.json(200, "[]"))
        _ = try await seam.sessions()
        #expect(seen.values == [false, true])
    }

    @Test func countsA500AsReached() async throws {
        let seen = Recorder<Bool>()
        let seam = Seam(baseUrl: "https://s", apiKey: "slop_k", transport: FakeTransport(.json(500)), onReachable: { seen.add($0) })
        await #expect(throws: SeamError.self) { try await seam.sessions() }
        #expect(seen.values == [true])
    }

    /// A cancelled request is a screen changing its mind, and treating it as an
    /// outage would flash the banner every time one goes away mid-fetch.
    @Test func doesNotCallACancellationADeadServer() async throws {
        let seen = Recorder<Bool>()
        let seam = Seam(baseUrl: "https://s", apiKey: "slop_k", transport: FakeTransport(.fail(URLError(.cancelled))), onReachable: { seen.add($0) })
        await #expect(throws: CancellationError.self) { try await seam.sessions() }
        #expect(seen.values == [])
    }

    // MARK: pairing

    @Test func readsWhatTheSettingsPageDraws() {
        #expect(parsePairingUri("slopcoder://pair?server=https%3A%2F%2Fslop.example.com&code=NDYZ9J5M")
            == PairingTarget(server: "https://slop.example.com", code: "NDYZ9J5M"))
    }

    @Test func refusesAQRThatIsNotOurs() {
        #expect(parsePairingUri("https://example.com") == nil)
        #expect(parsePairingUri("slopcoder://pair?code=ONLY") == nil)
    }

    // MARK: routines
    //
    // The paths still say `automations`. Two shapes here are easy to get wrong
    // and silent when you do: a command answers `TextResult`, where a *null*
    // value is success and a string is the problem to show, and the
    // enable/disable routes carry the boolean in the path behind a `:bool`
    // constraint.

    @Test func asksForTheBoardInThePhonesOwnZone() async throws {
        let transport = FakeTransport(.json(200, #"{"routines":[],"failures":[]}"#))
        _ = try await seam(transport).routineBoard(tz: "Europe/Berlin")
        #expect(transport.url(0) == "https://s/api/seam/automations/board?tz=Europe%2FBerlin")
    }

    @Test func leavesTheZoneOffEntirelyWhenThePhoneCouldNotNameIt() async throws {
        let transport = FakeTransport(.json(200, "{}"))
        _ = try await seam(transport).routineStatus(tz: nil)
        #expect(transport.url(0) == "https://s/api/seam/automations/status")
    }

    @Test func answersAnEmptyBoardRatherThanNilWhenThereIsNothing() async throws {
        let board = try await seam(FakeTransport(.json(404))).routineBoard()
        #expect(board.routines.isEmpty)
        #expect(board.failures.isEmpty)
        #expect(board.heartbeat == nil)
    }

    @Test func readsACommandAnswerAsTheProblemOrAsSilence() async throws {
        let transport = FakeTransport(.json(200, #"{"value":null}"#))
        let seam = seam(transport)
        #expect(try await seam.runRoutineNow("r1") == nil)
        transport.reset(.json(200, #"{"value":"The session is busy."}"#))
        #expect(try await seam.runRoutineNow("r1") == "The session is busy.")
    }

    @Test func doesNotReportAMissingRoutineAsACommandThatWorked() async throws {
        #expect(try await seam(FakeTransport(.json(404))).runRoutineNow("gone") == "That routine is gone.")
    }

    @Test func putsTheSwitchPositionInThePath() async throws {
        let transport = FakeTransport(.json(200, #"{"value":null}"#))
        _ = try await seam(transport).setRoutineEnabled("r1", enabled: false)
        #expect(transport.url(0) == "https://s/api/seam/automations/r1/enabled/false")
    }

    @Test func sendsAPromptInTheBodyNotInAURL() async throws {
        let transport = FakeTransport(.json(200, #"{"value":null}"#))
        _ = try await seam(transport).setRoutinePrompt("r1", prompt: "Check the queue.")
        #expect(transport.url(0) == "https://s/api/seam/automations/r1/prompt")
        #expect(transport.body() == ["value": "Check the queue."])
    }

    @Test func pagesARunLogAndTheRunUnderOneOfItsRows() async throws {
        let transport = FakeTransport(.json(200, #"{"runs":[],"total":0}"#))
        let seam = seam(transport)
        _ = try await seam.routineRuns("r1", skip: 30, take: 30)
        #expect(transport.url(0) == "https://s/api/seam/automations/r1/runs/page?skip=30&take=30")
        transport.reset(.json(200, "{}"))
        _ = try await seam.routineRun("r1", runId: "run9")
        #expect(transport.url(0) == "https://s/api/seam/automations/r1/runs/run9")
    }

    @Test func addingARepositoryPreservesTheServerTextResult() async throws {
        let transport = FakeTransport(.json(200, #"{"value":"Invalid repository URL"}"#))
        let seam = seam(transport, base: "https://slop.example.com")
        #expect(try await seam.addSessionRepository("abc", url: "bad") == "Invalid repository URL")
        #expect(transport.body() == ["url": "bad"])
        transport.reset(.json(200, #"{"value":null}"#))
        #expect(try await seam.addSessionRepository("abc", url: "https://example.test/repo") == nil)
        transport.reset(.json(404))
        #expect(try await seam.addSessionRepository("abc", url: "bad") == "That session is gone.")
    }
}
