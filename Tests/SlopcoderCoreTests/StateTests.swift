import Foundation
import Testing
@testable import SlopcoderCore

@MainActor
@Suite struct ConnectionStatusTests {
    @Test func countsARecoveryOnlyWhenItComesBack() {
        let status = ConnectionStatus()
        #expect(status.reachable)
        status.setReachable(true)
        #expect(status.recoveries == 0)
        status.setReachable(false)
        status.setReachable(false)
        #expect(status.recoveries == 0)
        status.setReachable(true)
        #expect(status.recoveries == 1)
    }
}

private let credential = Credential(server: "https://slop.example", apiKey: "sk-1", userName: "jessie")
private let never: SessionHub.Sleep = { _ in try await Task.sleep(nanoseconds: 60_000_000_000) }

// The shared hub, and the ways it stopped being shared.
//
// - Each screen built its own hub. Opening a session gave you a second socket,
//   and closing it announced the connection lost while the list's was still
//   connected.
// - Releasing between a push and a pop dropped the socket, for a reconnect and a
//   banner on every navigation.
@MainActor
@Suite struct HubCenterTests {
    final class Built: @unchecked Sendable {
        var connectors: [FakeConnector] = []
    }

    func center(_ status: ConnectionStatus, _ built: Built, grace: @escaping SessionHub.Sleep) -> HubCenter {
        HubCenter(connection: status, idleGraceMs: 5_000, sleep: grace) { options in
            let connector = FakeConnector()
            built.connectors.append(connector)
            return SessionHub(options, connector: connector, sleep: never, pingIntervalMs: 999_999)
        }
    }

    @Test func opensOneConnectionHoweverManyScreensWantIt() async {
        let status = ConnectionStatus()
        let built = Built()
        let center = center(status, built, grace: never)
        let list = center.acquire(credential)
        let detail = center.acquire(credential)
        #expect(built.connectors.count == 1)
        #expect(list === detail)
        #expect(await settled { status.live })

        // Stays live when a screen that was using it goes away: the list is still
        // showing, still subscribed, still receiving.
        center.release(detail)
        #expect(status.live)
        #expect(built.connectors.count == 1)
        center.release(list)
        center.teardown()
    }

    @Test func letsTheConnectionGoOnceNothingIsUsingIt() async {
        let status = ConnectionStatus()
        let built = Built()
        let center = center(status, built, grace: { _ in try await Task.sleep(nanoseconds: 20_000_000) })
        let only = center.acquire(credential)
        #expect(await settled { status.live })
        center.release(only)
        #expect(status.live)
        #expect(await settled { !status.live })
        #expect(center.current == nil)
    }

    @Test func keepsTheConnectionAcrossANavigation() async {
        let status = ConnectionStatus()
        let built = Built()
        let center = center(status, built, grace: { _ in try await Task.sleep(nanoseconds: 40_000_000) })
        let list = center.acquire(credential)
        #expect(await settled { status.live })
        // Push and pop, each of which releases before the next acquires.
        let detail = center.acquire(credential)
        center.release(list)
        center.release(detail)
        let again = center.acquire(credential)
        try? await Task.sleep(nanoseconds: 120_000_000)
        #expect(built.connectors.count == 1)
        #expect(status.live)
        #expect(again === list)
        center.teardown()
    }

    @Test func aDifferentCredentialIsADifferentConnection() async {
        let status = ConnectionStatus()
        let built = Built()
        let center = center(status, built, grace: never)
        let first = center.acquire(credential)
        let second = center.acquire(Credential(server: credential.server, apiKey: "sk-2", userName: "jessie"))
        #expect(first !== second)
        #expect(built.connectors.count == 2)
        #expect(await settled { !first.connected })
        center.teardown()
    }

    @Test func keepsTheReasonAHandshakeFailedSoTheBannerCanBeAskedWhy() async {
        let status = ConnectionStatus()
        let center = HubCenter(connection: status, sleep: never) { options in
            let connector = FakeConnector()
            connector.failNext = HubError("no route to host")
            return SessionHub(options, connector: connector, sleep: never, pingIntervalMs: 999_999)
        }
        _ = center.acquire(credential)
        #expect(await settled { status.reason == "no route to host" })
        #expect(status.live == false)
        center.teardown()
    }
}

@MainActor
@Suite struct AuthStoreTests {
    @Test func restoresTheStoredKeyAndBuildsTheSeam() {
        let auth = AuthStore(vault: MemoryVault(credential), connection: ConnectionStatus(), transport: FakeTransport())
        #expect(auth.ready == false)
        auth.restore()
        #expect(auth.ready)
        #expect(auth.credential == credential)
        #expect(auth.seam?.baseUrl == "https://slop.example")

        let empty = AuthStore(vault: MemoryVault(), connection: ConnectionStatus(), transport: FakeTransport())
        empty.restore()
        #expect(empty.ready)
        #expect(empty.seam == nil)
    }

    @Test func signsInKeepsTheKeyAndAsksForNotificationsThen() async throws {
        let vault = MemoryVault()
        let transport = FakeTransport(.json(200, #"{"fullKey":"slop_new","userName":"jessie"}"#))
        let auth = AuthStore(vault: vault, connection: ConnectionStatus(), transport: transport, deviceName: "iPhone (slopcoder)")
        var asked = 0
        auth.onSignedIn = { asked += 1 }

        try await auth.signInWithPassword(server: "https://slop.example/", userName: "jessie", password: "pw")
        #expect(transport.url(0) == "https://slop.example/api/auth/device/password")
        #expect(transport.body() == ["userName": "jessie", "password": "pw", "deviceName": "iPhone (slopcoder)"])
        #expect(vault.load()?.apiKey == "slop_new")
        #expect(auth.seam?.apiKey == "slop_new")
        #expect(asked == 1)

        transport.reset(.json(200, #"{"fullKey":"slop_paired","userName":"jessie"}"#))
        try await auth.signInWithPairingCode(server: "https://slop.example", code: "NDYZ9J5M")
        #expect(transport.url(0) == "https://slop.example/api/auth/device/pair")
        #expect(transport.body()["code"] == "NDYZ9J5M")
        #expect(auth.credential?.apiKey == "slop_paired")
    }

    @Test func aRefusedSignInKeepsNothing() async {
        let vault = MemoryVault()
        let auth = AuthStore(vault: vault, connection: ConnectionStatus(), transport: FakeTransport(.json(401, #"{"error":"twofactor"}"#)))
        do {
            try await auth.signInWithPassword(server: "https://s", userName: "u", password: "p")
            Issue.record("expected a throw")
        } catch {
            #expect(loginMessage(error).contains("two-factor"))
        }
        #expect(vault.load() == nil)
        #expect(auth.seam == nil)
    }

    /// A 401 means the key was revoked. There is no refresh to attempt.
    @Test func aDeadKeySignsOutAndUnsubscribesFirst() async throws {
        let vault = MemoryVault(credential)
        let auth = AuthStore(vault: vault, connection: ConnectionStatus(), transport: FakeTransport(.json(401)))
        auth.restore()
        var order: [String] = []
        auth.beforeSignOut = { order.append(vault.load() == nil ? "key gone" : "key still here") }

        await #expect(throws: SignedOutError.self) { try await auth.seam!.sessions() }
        #expect(await settled { auth.credential == nil })
        #expect(auth.seam == nil)
        #expect(vault.load() == nil)
        // Unsubscribing is a seam call, and it needs the key.
        #expect(order == ["key still here"])
    }

    @Test func reachabilityReachesTheSharedStatus() async throws {
        let status = ConnectionStatus()
        let transport = FakeTransport(.fail(URLError(.notConnectedToInternet)))
        let auth = AuthStore(vault: MemoryVault(credential), connection: status, transport: transport)
        auth.restore()
        _ = try? await auth.seam!.sessions()
        #expect(await settled { !status.reachable })
        transport.reset(.json(200, "[]"))
        _ = try await auth.seam!.sessions()
        #expect(await settled { status.reachable && status.recoveries == 1 })
    }

    @Test func wordsEachWayASignInFails() {
        #expect(loginMessage(OfflineError()).contains("Could not reach"))
        #expect(loginMessage(SeamError(status: 401, message: "invalid")) == "That username and password did not match.")
        #expect(loginMessage(SeamError(status: 403, message: "inactive")) == "That account is deactivated.")
        #expect(loginMessage(SeamError(status: 429, message: "too-many-attempts")).contains("Too many attempts"))
        #expect(loginMessage(SeamError(status: 500, message: "boom")).contains("answered with an error"))
    }
}

// One session's live view, and the two ways a push goes missing.
@MainActor
@Suite struct SessionStoreTests {
    static func events(_ range: Range<Int>) -> String {
        "[" + range.map { #"{"ordinal":\#($0),"kind":"AssistantText","payloadJson":"{\"text\":\"t\#($0)\"}"}"# }.joined(separator: ",") + "]"
    }

    /// A server holding `total` events, answering the session and scrollback routes.
    static func server(total: Int, live: String = "null") -> RoutedTransport {
        RoutedTransport { request in
            if request.url.contains("/scrollback") {
                let query = parseQuery(String(request.url.split(separator: "?").last ?? ""))
                let from = Int(query["from"] ?? "0") ?? 0
                let take = Int(query["take"] ?? "0") ?? 0
                let end = take == 0 ? total : min(total, from + take)
                return (200, events(from..<max(from, end)))
            }
            if request.url.hasSuffix("/presence") { return (204, "") }
            return (200, #"{"id":"s1","title":"t","status":1,"nextOrdinal":\#(total),"live":\#(live),"pendingApprovalIds":["a1"]}"#)
        }
    }

    func open(_ transport: RoutedTransport, total: Int) async throws -> (SessionStore, FakeConnector, SessionHub) {
        let connector = FakeConnector()
        let hub = SessionHub(.init(baseUrl: "https://s", apiKey: "k"), connector: connector, sleep: never, pingIntervalMs: 999_999)
        try await hub.start()
        connector.last.seed = #"{"id":"s1","title":"t","status":1,"nextOrdinal":\#(total),"pendingApprovalIds":["a1"]}"#
        let store = SessionStore(seam: Seam(baseUrl: "https://s", apiKey: "k", transport: transport), hub: hub, id: "s1", sleep: never)
        await store.start()
        return (store, connector, hub)
    }

    func delta(_ nextOrdinal: Int, _ range: Range<Int>, patch: String = "null") -> String {
        #"{"type":1,"target":"Delta","arguments":["s1",{"id":"s1","title":"t","status":1,"nextOrdinal":\#(nextOrdinal)},\#(Self.events(range)),\#(patch)]}"# + "\u{1e}"
    }

    @Test func opensOnTheTailOfTheScrollbackNotTheWholeOfIt() async throws {
        let transport = Self.server(total: 300)
        let (store, connector, hub) = try await open(transport, total: 300)
        #expect(store.loading == false)
        #expect(store.error == nil)
        #expect(store.items.count == SessionStore.initialWindow)
        #expect(store.items.first?.ordinal == 180)
        #expect(store.canLoadEarlier)
        #expect(store.isPending(approval: "a1"))
        #expect(store.isPending(approval: "nope") == false)
        #expect(store.running)
        #expect(transport.urls.contains("https://s/api/seam/sessions/s1/scrollback?from=180&take=0"))
        // The sandbox is told somebody is watching.
        #expect(await settled { transport.count(containing: "/presence") == 1 })
        #expect(connector.last.targets == ["Subscribe"])
        store.stop()
        hub.stop()
    }

    @Test func foldsAPushInAndStreamsTheLiveTail() async throws {
        let (store, connector, hub) = try await open(Self.server(total: 3), total: 3)
        #expect(store.items.count == 3)
        connector.last.push(delta(4, 3..<4, patch: #"{"thinkingFrom":0,"thinkingAppend":"hm","textFrom":0,"textAppend":"Hel"}"#))
        #expect(await settled { store.items.count == 4 })
        #expect(store.live == LiveSnapshot(thinking: "hm", text: "Hel"))
        #expect(store.state?.nextOrdinal == 4)

        // Growth with no new event leaves the rows exactly as they were.
        let before = store.items
        connector.last.push(delta(4, 4..<4, patch: #"{"thinkingFrom":2,"thinkingAppend":"","textFrom":3,"textAppend":"lo"}"#))
        #expect(await settled { store.live?.text == "Hello" })
        #expect(store.items == before)

        // A null patch is the turn's text landing as an event: nothing left streaming.
        connector.last.push(delta(5, 4..<5))
        #expect(await settled { store.live == nil && store.items.count == 5 })
        store.stop()
        hub.stop()
    }

    @Test func pullsWhatAMissedPushLeftOut() async throws {
        let transport = Self.server(total: 3)
        let (store, connector, hub) = try await open(transport, total: 3)
        // Ordinals 3 and 4 never arrived; 5 cannot be stored without leaving a hole.
        transport.route { request in
            if request.url.contains("/scrollback") { return (200, Self.events(3..<6)) }
            return (204, "")
        }
        connector.last.push(delta(6, 5..<6))
        #expect(await settled { store.items.count == 6 })
        #expect(store.items.map(\.ordinal) == Array(0..<6))
        #expect(transport.urls.contains("https://s/api/seam/sessions/s1/scrollback?from=3&take=0"))
        store.stop()
        hub.stop()
    }

    @Test func reseedsWhenTheLiveTextFellBehindTheSender() async throws {
        let transport = Self.server(total: 2)
        let (store, connector, hub) = try await open(transport, total: 2)
        transport.route { _ in
            (200, #"{"id":"s1","title":"t","status":1,"nextOrdinal":2,"live":{"thinking":"","text":"the whole text so far"}}"#)
        }
        // The sender is at length 50 and we hold nothing: a push was missed, and
        // nothing in the patch stream will ever repair it.
        connector.last.push(delta(2, 2..<2, patch: #"{"thinkingFrom":0,"thinkingAppend":"","textFrom":50,"textAppend":"!"}"#))
        #expect(await settled { store.live?.text == "the whole text so far" })
        store.stop()
        hub.stop()
    }

    @Test func loadsEarlierPagesUntilThereAreNone() async throws {
        let transport = Self.server(total: 200)
        let (store, _, hub) = try await open(transport, total: 200)
        #expect(store.items.first?.ordinal == 80)

        let first = await store.loadEarlier()
        #expect(first == EarlierResult(progress: true, hasMore: false))
        #expect(store.items.count == 200)
        #expect(store.items.first?.ordinal == 0)
        #expect(store.canLoadEarlier == false)
        #expect(transport.urls.contains("https://s/api/seam/sessions/s1/scrollback?from=0&take=80"))

        let again = await store.loadEarlier()
        #expect(again == EarlierResult(progress: false, hasMore: false))
        store.stop()
        hub.stop()
    }

    @Test func saysASessionIsGoneRatherThanSpinning() async throws {
        let transport = RoutedTransport { _ in (404, "") }
        let (store, _, hub) = try await open(transport, total: 0)
        #expect(store.error == "That session is gone.")
        #expect(store.loading == false)
        store.stop()
        hub.stop()
    }

    @Test func stopsWatchingWhenTheScreenGoes() async throws {
        let (store, connector, hub) = try await open(Self.server(total: 1), total: 1)
        store.stop()
        #expect(await eventually { connector.last.targets == ["Subscribe", "Unsubscribe"] })
        connector.last.push(delta(2, 1..<2))
        try await Task.sleep(nanoseconds: 30_000_000)
        #expect(store.items.count == 1)
        hub.stop()
    }
}

@Suite struct ArtifactInfoCacheTests {
    final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var running = 0
        private(set) var peak = 0
        private(set) var asked: [String] = []
        func begin(_ id: String) { lock.withLock { running += 1; peak = max(peak, running); asked.append(id) } }
        func end() { lock.withLock { running -= 1 } }
    }

    @Test func everyCardForOneArtifactSharesOneRequestAndNoMoreThanTwoRunAtOnce() async throws {
        let counter = Counter()
        let cache = ArtifactInfoCache { id in
            counter.begin(id)
            try await Task.sleep(nanoseconds: 15_000_000)
            counter.end()
            return id == "gone" ? nil : ArtifactDetail(artifact: ArtifactSummary(id: id), text: "a body nobody keeps")
        }

        try await withThrowingTaskGroup(of: ArtifactInfoCache.Known.self) { group in
            for id in ["a", "a", "b", "c", "gone", "a", "d", "b"] { group.addTask { try await cache.info(id) } }
            for try await _ in group {}
        }
        #expect(counter.asked.sorted() == ["a", "b", "c", "d", "gone"])
        #expect(counter.peak <= ArtifactInfoCache.maxConcurrent)
        #expect(await cache.known("gone") == .gone)
        #expect(await cache.known("a") == .summary(ArtifactSummary(id: "a")))
        #expect(await cache.known("never asked") == nil)

        // Known now, so asking again costs nothing.
        _ = try await cache.info("a")
        #expect(counter.asked.count == 5)
    }

    @Test func aFailureIsNotRememberedSoTheNextLookRetries() async throws {
        let counter = Counter()
        let cache = ArtifactInfoCache { id in
            counter.begin(id)
            counter.end()
            if counter.asked.count == 1 { throw OfflineError() }
            return ArtifactDetail(artifact: ArtifactSummary(id: id))
        }
        await #expect(throws: OfflineError.self) { try await cache.info("a") }
        #expect(try await cache.info("a") == .summary(ArtifactSummary(id: "a")))
    }
}

// `slopcoder://…` — the URL a notification tap, Siri and a pasted link all open.
// That contract spans the server's push payload, the app delegate and the
// navigator with nothing in between, so it is pinned here.
@MainActor
@Suite struct RouterTests {
    let id = "01a09313-3900-7f10-bff7-e2c02724d9eb"

    @Test func routesToTheCockpitWithTheTabBarUnderIt() {
        let router = Router()
        router.tab = .usage
        #expect(router.open(url: URL(string: "slopcoder://session/\(id)")!))
        #expect(router.tab == .sessions)
        // Back has somewhere to go: the list is underneath.
        #expect(router.sessions == [.session(id: id)])
    }

    @Test func routesThePathThePushPayloadCarries() {
        // What PushNotificationService.NotifyAsync sends as `url`, minus its leading
        // slash — which is exactly what the app delegate strips.
        let router = Router()
        #expect(router.open(url: URL(string: "slopcoder://session/abc-123")!))
        #expect(router.sessions == [.session(id: "abc-123")])
    }

    @Test func opensAnArtifactAndItsEditions() {
        let router = Router()
        #expect(router.open(url: URL(string: "slopcoder://artifacts/abc-123")!))
        #expect(router.tab == .artifacts)
        #expect(router.artifacts == [.artifact(id: "abc-123", version: nil)])
        // `?v=N`, the web's spelling of an edition, is a screen of its own.
        #expect(router.open(url: URL(string: "slopcoder://artifacts/abc-123?v=2")!))
        #expect(router.artifacts == [.artifact(id: "abc-123", version: nil), .artifact(id: "abc-123", version: 2)])
    }

    @Test func givesAnotherArtifactAFreshScreenAndReturnsToOneAlreadyOpen() {
        let router = Router()
        router.sessions = [.session(id: id)]
        router.open(.artifact(id: "artifact-a", version: nil))
        router.open(.artifact(id: "artifact-b", version: nil))
        #expect(router.sessions == [.session(id: id), .artifact(id: "artifact-a", version: nil), .artifact(id: "artifact-b", version: nil)])
        router.open(.artifact(id: "artifact-a", version: nil))
        #expect(router.sessions == [.session(id: id), .artifact(id: "artifact-a", version: nil)])
        #expect(router.tab == .sessions)
    }

    @Test func landsOnTheSettingsPageTheWebsPathNames() {
        let router = Router()
        #expect(router.open(url: URL(string: "slopcoder://settings/api-keys")!))
        #expect(router.tab == .settings)
        #expect(router.settings == [.settings(.apiKeys)])
        #expect(router.open(url: URL(string: "slopcoder://settings/git-identity")!))
        #expect(router.settings == [.settings(.gitIdentity)])
        #expect(router.open(url: URL(string: "slopcoder://settings")!))
        #expect(router.settings == [])
        #expect(Set(SettingsPage.allCases.map(\.rawValue)) == ["connections", "mcp", "nodes", "terminal", "git-identity", "facets", "hooks", "memory", "skills", "channels", "api-keys"])
    }

    @Test func opensARoutineAndTheRunUnderIt() {
        let router = Router()
        #expect(router.open(url: URL(string: "slopcoder://routines/\(id)?run=r9")!))
        #expect(router.routines == [.routine(id: id, run: "r9")])
        #expect(router.open(url: URL(string: "slopcoder://routines")!))
        #expect(router.routines == [])
    }

    @Test func refusesWhatIsNotOurs() {
        let router = Router()
        #expect(router.open(url: URL(string: "https://example.com/session/x")!) == false)
        #expect(router.open(url: URL(string: "slopcoder://pair?code=1")!) == false)
        #expect(router.open(.external(url: "https://example.com")) == false)
        #expect(router.sessions.isEmpty)
    }

    @Test func pushesAndPopsOnTheTabThatIsShowing() {
        let router = Router()
        router.tab = .settings
        router.push(.settings(.memory))
        #expect(router.settings == [.settings(.memory)])
        #expect(router.sessions.isEmpty)
        router.pop()
        #expect(router.settings.isEmpty)
    }
}

@Suite struct ImageRulesTests {
    @Test func countsDecodedBytesWithoutDecoding() {
        #expect(ImageRules.decodedBytes("QUJD") == 3)
        #expect(ImageRules.decodedBytes("QUI=") == 2)
        #expect(ImageRules.decodedBytes("QQ==") == 1)
        #expect(ImageRules.decodedBytes("") == 0)
    }

    @Test func readsOnlyTheFormatsTheProvidersDo() {
        #expect(ImageRules.normalizeMediaType("image/JPG") == "image/jpeg")
        #expect(ImageRules.normalizeMediaType("image/webp") == "image/webp")
        #expect(ImageRules.normalizeMediaType("image/heic") == nil)
        #expect(ImageRules.normalizeMediaType(nil) == nil)
    }

    @Test func saysWhyAnImageCannotRide() {
        #expect(ImageRules.problem(name: "shot.heic", mediaType: "image/heic", base64: "QUJD") == "shot.heic is not an image the agent can read.")
        #expect(ImageRules.problem(name: nil, mediaType: "image/png", base64: "") == "That image could not be read.")
        let big = String(repeating: "A", count: (ImageRules.maxImageBytes + 3) / 3 * 4 + 4)
        #expect(ImageRules.problem(name: "big.png", mediaType: "image/png", base64: big) == "big.png is over 2 MB.")
        #expect(ImageRules.problem(name: "ok.png", mediaType: "image/png", base64: "QUJD") == nil)
    }

    @Test func shortensACloneUrlToOwnerAndName() {
        #expect(shortRepo("https://git.sand.town/sand_head/slopcoder.git") == "sand_head/slopcoder")
        #expect(shortRepo("git@github.com:a/b.git") == "git@github.com:a/b")
        #expect(shortRepo("") == "")
    }
}
