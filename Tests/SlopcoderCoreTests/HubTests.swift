// The live connection, and the ways it stopped being live.
//
// - `Delta` must bind exactly four arguments, or every live update is dropped
//   in silence.
// - A handshake that failed must be retried: launching out of signal otherwise
//   wedges the app behind "Reconnecting to live updates…" until it is killed.
// - A reconnect has forgotten every group and missed every registry change.

import Foundation
import Testing
@testable import SlopcoderCore

/// A socket a test drives by hand.
final class FakeSocket: HubSocket, @unchecked Sendable {
    private let lock = NSLock()
    private var inbox: [Result<String, Error>] = []
    private var waiter: CheckedContinuation<String, Error>?
    private(set) var sent: [String] = []
    private(set) var closed = false
    /// Answers `Subscribe` with this state, as the hub would.
    var seed: String? = #"{"id":"s1","nextOrdinal":7}"#

    func push(_ frame: String) { deliver(.success(frame)) }
    func drop(_ error: Error = HubError("socket reset")) { deliver(.failure(error)) }

    private func deliver(_ result: Result<String, Error>) {
        let waiting: CheckedContinuation<String, Error>? = lock.withLock {
            if let waiter { self.waiter = nil; return waiter }
            inbox.append(result)
            return nil
        }
        waiting?.resume(with: result)
    }

    func send(_ text: String) async throws {
        lock.withLock { sent.append(text) }
        if text == HubProtocol.handshake { push("{}\u{1e}"); return }
        guard let json = JSONValue.parse(String(text.dropLast())), json["type"].int == 1 else { return }
        let id = json["invocationId"].stringValue
        if json["target"].string == "Subscribe", let seed {
            push(#"{"type":3,"invocationId":"\#(id)","result":\#(seed)}"# + "\u{1e}")
        } else {
            push(#"{"type":3,"invocationId":"\#(id)","result":null}"# + "\u{1e}")
        }
    }

    func receive() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let ready: Result<String, Error>? = lock.withLock {
                if inbox.isEmpty { waiter = continuation; return nil }
                return inbox.removeFirst()
            }
            if let ready { continuation.resume(with: ready) }
        }
    }

    func close() { lock.withLock { closed = true } }

    var targets: [String] {
        lock.withLock { sent.compactMap { JSONValue.parse(String($0.dropLast()))?["target"].string } }
    }
}

final class FakeConnector: HubConnecting, @unchecked Sendable {
    private let lock = NSLock()
    var failNext: Error?
    private(set) var sockets: [FakeSocket] = []
    private(set) var attempts = 0

    func connect(baseUrl: String, apiKey: String) async throws -> HubSocket {
        try lock.withLock {
            attempts += 1
            if let failNext { throw failNext }
            let socket = FakeSocket()
            sockets.append(socket)
            return socket
        }
    }

    var last: FakeSocket { lock.withLock { sockets[sockets.count - 1] } }
    var count: Int { lock.withLock { attempts } }
}

/// Polls until `condition` holds; the hub does its work on tasks of its own.
func eventually(_ condition: @escaping () -> Bool) async -> Bool {
    for _ in 0..<400 {
        if condition() { return true }
        try? await Task.sleep(nanoseconds: 5_000_000)
    }
    return condition()
}

@Suite struct HubTests {
    let instant: SessionHub.Sleep = { ms in
        // Retries run at once; the keep-alive ping effectively never does.
        try await Task.sleep(nanoseconds: ms == 999_999 ? 60_000_000_000 : 1_000_000)
    }

    func hub(_ connector: FakeConnector, _ options: SessionHub.Options? = nil) -> SessionHub {
        SessionHub(options ?? .init(baseUrl: "https://slop.example", apiKey: "key"), connector: connector, sleep: instant, pingIntervalMs: 999_999)
    }

    @Test func bindsDeltaWithExactlyFourArguments() async throws {
        let connector = FakeConnector()
        let hub = hub(connector)
        let seen = Recorder<(String, Int, Int, String?)>()
        hub.addListener("s1") { id, state, events, patch in
            seen.add((id, state.nextOrdinal, events.count, patch?.textAppend))
        }
        try await hub.start()
        // The seed from the subscription on connect.
        #expect(await eventually { seen.values.count == 1 })

        let delta = #"{"type":1,"target":"Delta","arguments":["s1",{"id":"s1","nextOrdinal":9},[{"ordinal":7,"kind":"AssistantText","payloadJson":"{}"},{"ordinal":8,"kind":"AssistantText","payloadJson":"{}"}],{"thinkingFrom":0,"thinkingAppend":"","textFrom":0,"textAppend":"hi"}]}"#
        connector.last.push(delta + "\u{1e}")
        #expect(await eventually { seen.values.count == 2 })
        let last = seen.values[1]
        #expect(last.0 == "s1")
        #expect(last.1 == 9)
        #expect(last.2 == 2)
        #expect(last.3 == "hi")

        // A null patch is "no turn streaming", not a malformed call.
        connector.last.push(#"{"type":1,"target":"Delta","arguments":["s1",{"id":"s1","nextOrdinal":9},[],null]}"# + "\u{1e}")
        #expect(await eventually { seen.values.count == 3 })
        #expect(seen.values[2].3 == nil)

        // Three arguments cannot be bound, and are dropped rather than guessed at.
        connector.last.push(#"{"type":1,"target":"Delta","arguments":["s1",{"id":"s1","nextOrdinal":11},[]]}"# + "\u{1e}")
        connector.last.push(#"{"type":6}"# + "\u{1e}")
        try await Task.sleep(nanoseconds: 30_000_000)
        #expect(seen.values.count == 3)
        hub.stop()
    }

    @Test func onlyTellsTheSessionThatWasNamed() async throws {
        let connector = FakeConnector()
        let hub = hub(connector)
        let other = Recorder<Int>()
        hub.addListener("s2") { _, state, _, _ in other.add(state.nextOrdinal) }
        try await hub.start()
        #expect(await eventually { other.values.count == 1 })
        connector.last.push(#"{"type":1,"target":"Delta","arguments":["s1",{"id":"s1","nextOrdinal":9},[],null]}"# + "\u{1e}")
        try await Task.sleep(nanoseconds: 30_000_000)
        #expect(other.values.count == 1)
        hub.stop()
    }

    @Test func aHandshakeThatFailsTriesAgainRatherThanWedging() async throws {
        let connector = FakeConnector()
        connector.failNext = HubError("no route to host")
        let live = Recorder<Bool>()
        let trouble = Recorder<String?>()
        let hub = hub(connector, .init(
            baseUrl: "https://slop.example", apiKey: "key",
            onStateChange: { live.add($0) }, onTrouble: { trouble.add($0) }
        ))

        await #expect(throws: HubError.self) { try await hub.start() }
        #expect(hub.connected == false)
        // The phone has no console: the reason is kept so the banner can be asked why.
        #expect(hub.lastFailure == "no route to host")

        // The retry nothing else would make: it never connected once.
        #expect(await eventually { connector.count > 2 })
        connector.failNext = nil
        #expect(await eventually { hub.connected })
        // And the reason is dropped once there is nothing to explain.
        #expect(hub.lastFailure == nil)
        #expect(live.values.last == true)
        #expect(trouble.values.last! == nil)
        hub.stop()
    }

    @Test func resubscribesAndRefreshesTheRegistryAfterAReconnect() async throws {
        let connector = FakeConnector()
        let registry = Recorder<Bool>()
        let listener = Recorder<Bool>()
        let hub = hub(connector, .init(baseUrl: "https://slop.example", apiKey: "key", onRegistryChanged: { registry.add(true) }))
        let seeds = Recorder<Int>()
        hub.addListener("s1") { _, state, _, _ in seeds.add(state.nextOrdinal) }
        let unsubscribe = hub.addRegistryListener { listener.add(true) }

        try await hub.start()
        #expect(await eventually { seeds.values.count == 1 })
        // A first connection has missed nothing.
        #expect(registry.values.isEmpty)

        connector.last.drop()
        #expect(await eventually { connector.sockets.count == 2 && hub.connected })
        // Group membership did not survive: the new socket was asked to subscribe again…
        #expect(await eventually { connector.last.targets == ["Subscribe"] })
        // …the listener got a state-only delta to heal the gap from…
        #expect(await eventually { seeds.values.count == 2 })
        // …and registry changes during the outage were not delivered, so re-list.
        #expect(await eventually { registry.values.count == 1 && listener.values.count == 1 })

        unsubscribe()
        connector.last.push(#"{"type":1,"target":"RegistryChanged","arguments":[]}"# + "\u{1e}")
        #expect(await eventually { registry.values.count == 2 })
        #expect(listener.values.count == 1)
        hub.stop()
    }

    @Test func unsubscribesOnlyWhenNobodyIsStillWatching() async throws {
        let connector = FakeConnector()
        let hub = hub(connector)
        let first = hub.addListener("s1") { _, _, _, _ in }
        let second = hub.addListener("s1") { _, _, _, _ in }
        try await hub.start()
        #expect(await eventually { connector.last.targets == ["Subscribe"] })

        hub.removeListener("s1", first)
        await hub.unsubscribe("s1")
        #expect(connector.last.targets == ["Subscribe"])

        hub.removeListener("s1", second)
        await hub.unsubscribe("s1")
        #expect(connector.last.targets == ["Subscribe", "Unsubscribe"])
        hub.stop()
    }

    @Test func stopIsFinal() async throws {
        let connector = FakeConnector()
        let hub = hub(connector)
        try await hub.start()
        let socket = connector.last
        hub.stop()
        #expect(socket.closed)
        try await hub.start()
        try await Task.sleep(nanoseconds: 20_000_000)
        #expect(connector.count == 1)
        #expect(hub.connected == false)
    }

    @Test func socketUrlsFollowTheServersScheme() {
        #expect(HubConnector.socketUrl("https://s/hubs/session?id=a") == "wss://s/hubs/session?id=a")
        #expect(HubConnector.socketUrl("http://10.0.0.2:5000/hubs/session?id=a") == "ws://10.0.0.2:5000/hubs/session?id=a")
    }

    @Test func retryCadenceNeverGivesUp() {
        #expect([0, 1, 2, 3, 50].map(steadyRetryDelayMs) == [0, 2_000, 10_000, 30_000, 30_000])
    }
}
