// The live half of the client, ported from `src/SlopCoder.Client/HubSessionApi.cs`.
//
// Commands go over REST; this connection only *receives*. The hub exposes
// `Subscribe`/`Unsubscribe` and nothing else, deliberately — every mutation
// revalidates the credential on its own request.
//
// There is no SignalR client for Swift worth depending on, so the protocol is
// spoken here directly. It is small: a negotiate POST, a JSON handshake, and
// records separated by 0x1E (`HubProtocol`). What is worth stating plainly:
//
// - **An argument-list mismatch never throws.** `Delta` takes exactly four
//   arguments. An invocation with any other count cannot be bound and is
//   dropped — which, were the server and client ever to disagree, would kill
//   every live update while the unit tests stayed green. `HubTests` pins the
//   four.
// - **Group membership does not survive a reconnect.** Every subscription must
//   be re-established and re-seeded, or the session goes quiet while looking
//   connected. On a phone this is the common case, not the edge case.
// - **Nothing gives up.** A phone loses its socket every time the screen
//   sleeps and may launch with no network at all, so a failed handshake and a
//   dropped socket are retried on the same cadence until told to stop.
// - **A transport that cannot connect is silent.** Whatever goes wrong — a
//   proxy that will not upgrade, an auth scheme the socket handshake does not
//   carry, a network that eats WebSockets — surfaces to the app as a connection
//   that simply never arrives. So: long polling is the fallback, and the reason
//   the last attempt failed is kept for the UI to show.

import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - protocol

/// SignalR's JSON hub protocol: text records, each ended by 0x1E.
public enum HubProtocol {
    public static let separator: Character = "\u{1e}"
    public static let handshake = #"{"protocol":"json","version":1}"# + "\u{1e}"
    public static let ping = #"{"type":6}"# + "\u{1e}"

    public enum Message: Equatable {
        case invocation(target: String, arguments: [JSONValue])
        case completion(id: String, result: JSONValue, error: String?)
        case ping
        case close(error: String?)
        case other
    }

    /// Splits a frame into its records. A frame may carry several, and the
    /// handshake answer may share one with the first invocation.
    public static func records(_ frame: String) -> [String] {
        frame.split(separator: separator, omittingEmptySubsequences: true).map(String.init)
    }

    public static func parse(_ record: String) -> Message {
        guard let json = JSONValue.parse(record) else { return .other }
        switch json["type"].int {
        case 1:
            return .invocation(target: json["target"].stringValue, arguments: json["arguments"].arrayValue)
        case 3:
            return .completion(id: json["invocationId"].stringValue, result: json["result"], error: json["error"].string)
        case 6:
            return .ping
        case 7:
            return .close(error: json["error"].string)
        default:
            return .other
        }
    }

    public static func invocation(id: String, target: String, arguments: [JSONValue]) -> String {
        JSONValue.object([
            "type": 1,
            "invocationId": .string(id),
            "target": .string(target),
            "arguments": .array(arguments),
        ]).serialized() + String(separator)
    }
}

/// An established byte pipe to the hub, before the SignalR handshake.
public protocol HubSocket: AnyObject, Sendable {
    func send(_ text: String) async throws
    /// The next frame. Throws when the pipe closes.
    func receive() async throws -> String
    func close()
}

/// How a socket comes to exist. The app's is `HubConnector`; tests script one.
public protocol HubConnecting: Sendable {
    func connect(baseUrl: String, apiKey: String) async throws -> HubSocket
}

public struct HubError: Error, LocalizedError, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

// MARK: - the hub

public typealias DeltaHandler = @Sendable (
    _ sessionId: String, _ state: SessionState, _ events: [AgentEventEnvelope], _ patch: LivePatch?
) -> Void

/// The retry cadence. SignalR's default policy gives up after about forty
/// seconds; giving up is never right here, so back off to every thirty seconds
/// and keep trying.
public func steadyRetryDelayMs(previousRetryCount: Int) -> Int {
    switch previousRetryCount {
    case 0: return 0
    case 1: return 2_000
    case 2: return 10_000
    default: return 30_000
    }
}

public final class SessionHub: Sendable {
    public struct Options: Sendable {
        public var baseUrl: String
        public var apiKey: String
        /// The session registry changed — re-list. Carries no payload by design.
        public var onRegistryChanged: (@Sendable () -> Void)?
        public var onStateChange: (@Sendable (Bool) -> Void)?
        /// Why the connection is not up, or nil once it is.
        public var onTrouble: (@Sendable (String?) -> Void)?

        public init(
            baseUrl: String,
            apiKey: String,
            onRegistryChanged: (@Sendable () -> Void)? = nil,
            onStateChange: (@Sendable (Bool) -> Void)? = nil,
            onTrouble: (@Sendable (String?) -> Void)? = nil
        ) {
            self.baseUrl = baseUrl
            self.apiKey = apiKey
            self.onRegistryChanged = onRegistryChanged
            self.onStateChange = onStateChange
            self.onTrouble = onTrouble
        }
    }

    public typealias Sleep = @Sendable (_ milliseconds: Int) async throws -> Void

    private let options: Options
    private let connector: HubConnecting
    private let sleep: Sleep
    private let pingIntervalMs: Int

    /// Everything that changes, read and written only under one lock — the
    /// same critical sections the hub has always had, now with the compiler
    /// checking that nothing escapes them.
    private struct State: Sendable {
        var socket: HubSocket?
        var connecting = false
        var isConnected = false
        /// Why the last attempt failed, for a UI that would otherwise say nothing.
        var failure: String?
        var attempts = 0
        var stopped = false
        var retryTask: Task<Void, Never>?
        var pumpTask: Task<Void, Never>?
        var pingTask: Task<Void, Never>?
        var nextInvocation = 0
        var pending: [String: CheckedContinuation<JSONValue, Error>] = [:]
        /// Per-session handlers. A session with none left is unsubscribed.
        var listeners: [String: [UUID: DeltaHandler]] = [:]
        var registryListeners: [UUID: @Sendable () -> Void] = [:]
    }

    private let state = Locked(State())

    public init(
        _ options: Options,
        connector: HubConnecting = HubConnector(),
        sleep: @escaping Sleep = { try await Task.sleep(nanoseconds: UInt64(max(0, $0)) * 1_000_000) },
        pingIntervalMs: Int = 15_000
    ) {
        self.options = options
        self.connector = connector
        self.sleep = sleep
        self.pingIntervalMs = pingIntervalMs
    }

    public var connected: Bool { state.withLock { $0.isConnected } }

    /// What went wrong last, or nil if nothing has.
    public var lastFailure: String? { state.withLock { $0.failure } }

    /// Connects. Throws when the attempt fails — and has already scheduled the
    /// next one by then, so a caller may ignore the error.
    public func start() async throws {
        let proceed: Bool = state.withLock { state in
            if state.socket != nil || state.connecting || state.stopped { return false }
            state.connecting = true
            return true
        }
        guard proceed else { return }

        do {
            let socket = try await connector.connect(baseUrl: trimTrailingSlashes(options.baseUrl), apiKey: options.apiKey)
            try await handshake(socket)

            let abandon: Bool = state.withLock { state in
                state.connecting = false
                if state.stopped { return true }
                state.socket = socket
                state.isConnected = true
                state.attempts = 0
                return false
            }
            if abandon {
                socket.close()
                return
            }
        } catch {
            // Leaving a never-started connection assigned would wedge the hub for
            // the life of the process: every later `start()` would return at the
            // guard above. The app then sits behind "Reconnecting to live
            // updates…" forever.
            state.withLock { $0.connecting = false }
            note(error)
            options.onStateChange?(false)
            scheduleRetry()
            throw error
        }

        note(nil)
        options.onStateChange?(true)
        startPump()
        await resubscribeAll()
    }

    private func handshake(_ socket: HubSocket) async throws {
        try await socket.send(HubProtocol.handshake)
        let frame = try await socket.receive()
        let records = HubProtocol.records(frame)
        guard let first = records.first else { throw HubError("The server closed the connection during the handshake.") }
        if let error = JSONValue.parse(first)?["error"].string { throw HubError(error) }
        // Anything that rode in with the handshake answer is a real message.
        for record in records.dropFirst() { dispatch(record) }
    }

    private func startPump() {
        guard let socket = state.withLock({ $0.socket }) else { return }

        let pump = Task { [weak self] in
            var reason: Error?
            do {
                while !Task.isCancelled {
                    let frame = try await socket.receive()
                    for record in HubProtocol.records(frame) {
                        if let closing = self?.dispatch(record) { throw closing }
                    }
                }
            } catch {
                reason = error
            }
            self?.dropped(socket, reason: reason)
        }

        // The server closes a connection it has not heard from in thirty seconds.
        let interval = pingIntervalMs
        let sleep = self.sleep
        let ping = Task {
            while !Task.isCancelled {
                do {
                    try await sleep(interval)
                    try await socket.send(HubProtocol.ping)
                } catch {
                    return
                }
            }
        }

        state.withLock { state in
            state.pumpTask = pump
            state.pingTask = ping
        }
    }

    /// Handles one record. Returns an error when the server said to close.
    @discardableResult
    private func dispatch(_ record: String) -> Error? {
        switch HubProtocol.parse(record) {
        case .invocation(let target, let arguments):
            invoked(target, arguments)
        case .completion(let id, let result, let error):
            let waiting = state.withLock { $0.pending.removeValue(forKey: id) }
            if let error {
                waiting?.resume(throwing: HubError(error))
            } else {
                waiting?.resume(returning: result)
            }
        case .close(let error):
            return HubError(error ?? "The server closed the connection.")
        case .ping, .other:
            break
        }
        return nil
    }

    private func invoked(_ target: String, _ arguments: [JSONValue]) {
        switch target {
        case "Delta":
            // Exactly four parameters. See the note at the top of this file.
            guard arguments.count == 4,
                  let sessionId = arguments[0].string,
                  let state = arguments[1].decoded(SessionState.self)
            else { return }
            let events = arguments[2].decoded([AgentEventEnvelope].self) ?? []
            let patch = arguments[3].isNull ? nil : arguments[3].decoded(LivePatch.self)
            let handlers = self.state.withLock { Array(($0.listeners[sessionId] ?? [:]).values) }
            for handler in handlers { handler(sessionId, state, events, patch) }
        case "RegistryChanged":
            announceRegistryChanged()
        default:
            break
        }
    }

    private func announceRegistryChanged() {
        options.onRegistryChanged?()
        let registry = state.withLock { Array($0.registryListeners.values) }
        for listener in registry { listener() }
    }

    /// The socket went away without `stop()` asking it to.
    private func dropped(_ socket: HubSocket, reason: Error?) {
        let (ours, waiting): (Bool, [CheckedContinuation<JSONValue, Error>]) = state.withLock { state in
            guard state.socket === socket else { return (false, []) }
            state.socket = nil
            state.isConnected = false
            state.pingTask?.cancel()
            state.pingTask = nil
            state.pumpTask = nil
            let waiting = Array(state.pending.values)
            state.pending.removeAll()
            return (true, waiting)
        }
        guard ours else { return }

        socket.close()
        for continuation in waiting { continuation.resume(throwing: HubError("The connection dropped.")) }
        note(reason ?? HubError("The connection dropped."))
        options.onStateChange?(false)
        scheduleRetry(afterDrop: true)
    }

    /// Keep the reason, and tell whoever is listening.
    ///
    /// The transport's own messages are the useful ones here — a failed
    /// negotiation, a status code — and they are otherwise written to a console
    /// nobody can read on a phone.
    private func note(_ error: Error?) {
        let reason = error.map(describe)
        state.withLock { $0.failure = reason }
        options.onTrouble?(reason)
    }

    /// Try again later. The first delay after a failed *handshake* is floored:
    /// the cadence answers 0 for a first retry, which is right when the socket
    /// was up a moment ago and a busy loop when the server is simply down.
    private func scheduleRetry(afterDrop: Bool = false) {
        let sleep = self.sleep
        state.withLock { state in
            if state.stopped || state.retryTask != nil || state.socket != nil { return }
            let delay = steadyRetryDelayMs(previousRetryCount: state.attempts)
            state.attempts += 1
            let wait = afterDrop ? delay : max(delay, 1_000)
            state.retryTask = Task { [weak self] in
                do {
                    if wait > 0 { try await sleep(wait) }
                } catch {
                    return
                }
                guard let self else { return }
                self.state.withLock { $0.retryTask = nil }
                do {
                    try await self.start()
                } catch {
                    return
                }
                // A hub that came back has missed whatever the registry did
                // while it was away.
                if self.connected { self.announceRegistryChanged() }
            }
        }
    }

    /// "Something in your session list changed" — the push carries no payload.
    /// Returns the call that stops listening.
    @discardableResult
    public func addRegistryListener(_ listener: @escaping @Sendable () -> Void) -> @Sendable () -> Void {
        let id = UUID()
        state.withLock { $0.registryListeners[id] = listener }
        return { [weak self] in
            guard let self else { return }
            self.state.withLock { _ = $0.registryListeners.removeValue(forKey: id) }
        }
    }

    /// Returns the token `removeListener` takes.
    @discardableResult
    public func addListener(_ sessionId: String, _ handler: @escaping DeltaHandler) -> UUID {
        let id = UUID()
        state.withLock { $0.listeners[sessionId, default: [:]][id] = handler }
        return id
    }

    public func removeListener(_ sessionId: String, _ token: UUID) {
        state.withLock { state in
            guard var existing = state.listeners[sessionId] else { return }
            existing.removeValue(forKey: token)
            state.listeners[sessionId] = existing.isEmpty ? nil : existing
        }
    }

    private func invoke(_ target: String, _ arguments: [JSONValue]) async throws -> JSONValue {
        let (socket, id): (HubSocket?, String) = state.withLock { state in
            state.nextInvocation += 1
            return (state.isConnected ? state.socket : nil, String(state.nextInvocation))
        }
        guard let socket else { throw HubError("Not connected.") }

        return try await withCheckedThrowingContinuation { continuation in
            state.withLock { $0.pending[id] = continuation }
            Task {
                do {
                    try await socket.send(HubProtocol.invocation(id: id, target: target, arguments: arguments))
                } catch {
                    let waiting = self.state.withLock { $0.pending.removeValue(forKey: id) }
                    waiting?.resume(throwing: error)
                }
            }
        }
    }

    /// Returns the seed state — the snapshot every later delta is relative to.
    public func subscribe(_ sessionId: String) async throws -> SessionState? {
        guard connected else { return nil }
        return try await invoke("Subscribe", [.string(sessionId)]).decoded(SessionState.self)
    }

    public func unsubscribe(_ sessionId: String) async {
        // Someone else on this screen stack may still be watching.
        let stillWatched = state.withLock { $0.listeners[sessionId] != nil }
        guard !stillWatched, connected else { return }
        // A connection that dropped has already forgotten the group.
        _ = try? await invoke("Unsubscribe", [.string(sessionId)])
    }

    /// After a reconnect the server has forgotten every group, so re-join each
    /// one and hand the listeners a fresh state. They treat it as a state-only
    /// delta, which is exactly what drives the gap machinery to heal the hole the
    /// disconnection left.
    private func resubscribeAll() async {
        let sessionIds = self.state.withLock { Array($0.listeners.keys) }
        for sessionId in sessionIds {
            // The next reconnect will try again.
            guard let value = try? await invoke("Subscribe", [.string(sessionId)]),
                  let state = value.decoded(SessionState.self)
            else { continue }
            let handlers = self.state.withLock { Array(($0.listeners[sessionId] ?? [:]).values) }
            for handler in handlers { handler(sessionId, state, [], nil) }
        }
    }

    public func stop() {
        let (socket, waiting): (HubSocket?, [CheckedContinuation<JSONValue, Error>]) = state.withLock { state in
            state.stopped = true
            state.retryTask?.cancel()
            state.retryTask = nil
            state.pumpTask?.cancel()
            state.pumpTask = nil
            state.pingTask?.cancel()
            state.pingTask = nil
            let socket = state.socket
            state.socket = nil
            state.isConnected = false
            state.listeners.removeAll()
            state.registryListeners.removeAll()
            let waiting = Array(state.pending.values)
            state.pending.removeAll()
            return (socket, waiting)
        }
        for continuation in waiting { continuation.resume(throwing: CancellationError()) }
        socket?.close()
    }
}

// MARK: - transports

/// Negotiates, then opens a WebSocket — or, when the socket cannot be
/// established at all, long-polls.
///
/// Bearer on negotiate and on the socket's handshake request. Negotiation is
/// never skipped: it surfaces a dead key as a clean 401, and a fallback cannot
/// happen without it. Server-sent events are not attempted — there is nothing
/// they would rescue that long polling does not.
public struct HubConnector: HubConnecting {
    private let transport: HTTPTransport
    private let session: URLSession

    public init(transport: HTTPTransport = URLSessionTransport(), session: URLSession = .shared) {
        self.transport = transport
        self.session = session
    }

    public func connect(baseUrl: String, apiKey: String) async throws -> HubSocket {
        let hubUrl = "\(baseUrl)/hubs/session"
        let headers = ["Authorization": "Bearer \(apiKey)", clientHeader: "1"]

        let negotiated = try await transport.send(
            HTTPRequest(method: "POST", url: "\(hubUrl)/negotiate?negotiateVersion=1", headers: headers, body: Data())
        )
        if negotiated.status == 401 { throw HubError("The server rejected this device’s key (401 on negotiate).") }
        guard negotiated.ok, let answer = JSONValue.parse(negotiated.body) else {
            throw HubError("Failed to complete negotiation with the server: \(negotiated.status)")
        }
        guard let token = answer["connectionToken"].string ?? answer["connectionId"].string else {
            throw HubError("Failed to complete negotiation with the server: no connection id.")
        }
        let offered = Set(answer["availableTransports"].arrayValue.map { $0["transport"].stringValue })
        let query = "id=\(encodeURIComponent(token))"

        var socketFailure: Error = HubError("The server offers no transport this app speaks.")
        if offered.isEmpty || offered.contains("WebSockets") {
            do {
                return try await WebSocketHubSocket.open(
                    url: Self.socketUrl("\(hubUrl)?\(query)"), headers: headers, session: session
                )
            } catch {
                if isCancellation(error) { throw error }
                socketFailure = HubError("WebSocket failed: \(describe(error))")
            }
        }
        if offered.contains("LongPolling") {
            return LongPollingHubSocket(url: "\(hubUrl)?\(query)", headers: headers, transport: transport)
        }
        throw socketFailure
    }

    static func socketUrl(_ url: String) -> String {
        if url.hasPrefix("https://") { return "wss://" + url.dropFirst("https://".count) }
        if url.hasPrefix("http://") { return "ws://" + url.dropFirst("http://".count) }
        return url
    }
}

final class WebSocketHubSocket: HubSocket {
    private let task: URLSessionWebSocketTask

    private init(task: URLSessionWebSocketTask) {
        self.task = task
    }

    /// Opens the socket and proves it is up by sending nothing and waiting for
    /// nothing: `URLSessionWebSocketTask` reports a failed upgrade on the first
    /// send, which the SignalR handshake is about to be.
    static func open(url: String, headers: [String: String], session: URLSession) async throws -> WebSocketHubSocket {
        guard let target = URL(string: url) else { throw URLError(.badURL) }
        var request = URLRequest(url: target)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let task = session.webSocketTask(with: request)
        task.resume()
        let socket = WebSocketHubSocket(task: task)
        do {
            // A ping settles whether the upgrade happened, so a refusal falls
            // back to long polling here rather than failing inside the handshake.
            try await socket.probe()
        } catch {
            task.cancel(with: .goingAway, reason: nil)
            throw error
        }
        return socket
    }

    private func probe() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            task.sendPing { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    func send(_ text: String) async throws {
        try await task.send(.string(text))
    }

    func receive() async throws -> String {
        switch try await task.receive() {
        case .string(let text): return text
        case .data(let data): return String(decoding: data, as: UTF8.self)
        @unknown default: return ""
        }
    }

    func close() {
        task.cancel(with: .normalClosure, reason: nil)
    }
}

/// SignalR long polling: a GET that hangs until there is something to say, a
/// POST per send, a DELETE to hang up.
final class LongPollingHubSocket: HubSocket {
    private let url: String
    private let headers: [String: String]
    private let transport: HTTPTransport
    private let closed = Locked(false)

    init(url: String, headers: [String: String], transport: HTTPTransport) {
        self.url = url
        self.headers = headers
        self.transport = transport
    }

    func send(_ text: String) async throws {
        var headers = self.headers
        headers["Content-Type"] = "text/plain;charset=UTF-8"
        let response = try await transport.send(HTTPRequest(method: "POST", url: url, headers: headers, body: Data(text.utf8)))
        if !response.ok { throw HubError("Long polling send failed: \(response.status)") }
    }

    func receive() async throws -> String {
        while true {
            if closed.withLock({ $0 }) { throw HubError("The connection was closed.") }
            let stamp = Int(Date().timeIntervalSince1970 * 1000)
            let response = try await transport.send(HTTPRequest(method: "GET", url: "\(url)&_=\(stamp)", headers: headers))
            // 204 is the server ending the poll for good; 200 with nothing is a
            // poll that timed out and should simply be asked again.
            if response.status == 204 { throw HubError("The server ended the connection.") }
            if !response.ok { throw HubError("Long polling failed: \(response.status)") }
            if !response.body.isEmpty { return response.text }
        }
    }

    func close() {
        let already = closed.withLock { closed -> Bool in
            let was = closed
            closed = true
            return was
        }
        if already { return }
        let request = HTTPRequest(method: "DELETE", url: url, headers: headers)
        let transport = self.transport
        Task { _ = try? await transport.send(request) }
    }
}
