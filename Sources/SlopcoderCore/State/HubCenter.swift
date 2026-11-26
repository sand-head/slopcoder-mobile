// One hub connection for the whole app, tied to the current credential.
//
// Sessions come and go as screens push and pop; the socket does not. Screens
// register a listener for the session they are showing and the hub multiplexes.
//
// The connection is shared rather than one per screen, because two screens are
// alive at once for as long as a session sits open over the list. A hub each
// meant two sockets and two subscriptions per session — and, worse, that
// leaving the session tore one of them down and announced the connection lost
// while the list's was still live. Nothing ever said otherwise, so the app sat
// behind "Reconnecting to live updates…" until it was killed.

import Foundation

@MainActor
public final class HubCenter {
    public typealias MakeHub = @MainActor (SessionHub.Options) -> SessionHub

    private struct Shared {
        let key: String
        let hub: SessionHub
        var refs: Int
    }

    private let connection: ConnectionStatus
    private let makeHub: MakeHub
    /// Long enough to cover a navigation, short enough that a logout is not a leak.
    private let idleGraceMs: Int
    private let sleep: SessionHub.Sleep
    private var shared: Shared?
    private var idleTask: Task<Void, Never>?

    public init(
        connection: ConnectionStatus,
        idleGraceMs: Int = 5_000,
        sleep: @escaping SessionHub.Sleep = { try await Task.sleep(nanoseconds: UInt64(max(0, $0)) * 1_000_000) },
        makeHub: @escaping MakeHub = { SessionHub($0) }
    ) {
        self.connection = connection
        self.idleGraceMs = idleGraceMs
        self.sleep = sleep
        self.makeHub = makeHub
    }

    /// The hub for a credential, started if this is the first asker. Every
    /// `acquire` is owed one `release`.
    public func acquire(_ credential: Credential) -> SessionHub {
        if let current = shared, current.key != credential.connectionKey { teardown() }

        idleTask?.cancel()
        idleTask = nil

        if shared == nil {
            let connection = self.connection
            let hub = makeHub(SessionHub.Options(
                baseUrl: credential.server,
                apiKey: credential.apiKey,
                onStateChange: { live in Task { @MainActor in connection.setLive(live) } },
                onTrouble: { reason in Task { @MainActor in connection.setReason(reason) } }
            ))
            shared = Shared(key: credential.connectionKey, hub: hub, refs: 0)
            // The hub owns its own retry from here: a failed first handshake is not a
            // reason to stop trying, and nothing out here would notice if it were.
            Task { try? await hub.start() }
        }

        shared?.refs += 1
        let hub = shared!.hub
        connection.setLive(hub.connected)
        connection.setReason(hub.lastFailure)
        return hub
    }

    public func release(_ hub: SessionHub) {
        guard var current = shared, current.hub === hub else { return }

        current.refs -= 1
        shared = current
        if current.refs > 0 { return }

        // Navigating from one screen that wants the hub to another releases before it
        // acquires, and dropping the socket in that gap would cost a reconnect — and
        // a banner — on every push and pop.
        let wait = idleGraceMs
        let sleep = self.sleep
        idleTask = Task { [weak self] in
            do {
                try await sleep(wait)
            } catch {
                return
            }
            guard let self, !Task.isCancelled else { return }
            self.idleTask = nil
            if let current = self.shared, current.refs == 0 { self.teardown() }
        }
    }

    /// Drop the connection now: a sign-out, or a different credential.
    public func teardown() {
        let current = shared
        shared = nil
        idleTask?.cancel()
        idleTask = nil

        guard let current else { return }
        connection.setLive(false)
        current.hub.stop()
    }

    /// iOS suspends sockets in the background, and a hub between retries will
    /// not notice it is back in front. Coming forward is the poke.
    public func poke() {
        guard let hub = shared?.hub, !hub.connected else { return }
        Task { try? await hub.start() }
    }

    /// The hub in use, without taking a reference.
    public var current: SessionHub? { shared?.hub }
}

/// One re-read at a time. Registry signals can arrive in bursts; a signal
/// during a read coalesces into one follow-up rather than racing list updates.
@MainActor
public final class SerialRefresh {
    private let run: @MainActor () async -> Void
    private var running = false
    private var again = false

    public init(_ run: @escaping @MainActor () async -> Void) {
        self.run = run
    }

    public func callAsFunction() {
        if running {
            again = true
            return
        }
        running = true
        Task { @MainActor in
            repeat {
                again = false
                await run()
            } while again
            running = false
        }
    }
}
