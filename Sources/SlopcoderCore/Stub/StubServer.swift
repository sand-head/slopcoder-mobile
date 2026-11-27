// The stub's two halves: the REST seam and the hub, in process.
//
// It answers the reads the screens make, records every request, and treats a
// message the way the server would from the outside: the prompt lands in the
// scrollback, the agent answers, the turn closes, and every hub socket watching
// the session is sent the delta. A path it does not know is a 404, as the
// server's own answer to anything it does not route — never a request left
// hanging.

import Foundation

/// One request the stub was asked, and what it answered.
public struct StubExchange: Sendable, Equatable {
    public var method: String
    /// The path under the server, without the query: `api/seam/sessions/`.
    public var path: String
    public var query: [String: String]
    public var status: Int
    public var body: JSONValue?
}

public final class StubServer: HTTPTransport, HubConnecting {
    private struct Session: Sendable {
        var summary: SessionSummary
        var events: [AgentEventEnvelope]
        var state: SessionState { StubWorld.state(summary, nextOrdinal: events.count) }
    }

    private struct State: Sendable {
        var sessions: [String: Session]
        var exchanges: [StubExchange] = []
        var sockets: [StubHubSocket] = []
    }

    private let state: Locked<State>
    private let base: String

    public init(server: String = StubMode.credential.server) {
        base = trimTrailingSlashes(server) + "/"
        var sessions: [String: Session] = [:]
        for summary in StubWorld.sessions {
            sessions[summary.id] = Session(
                summary: summary,
                events: summary.id == StubWorld.idleId ? StubWorld.idleEvents : StubWorld.runningEvents
            )
        }
        state = Locked(State(sessions: sessions))
    }

    /// Everything asked so far, oldest first.
    public var exchanges: [StubExchange] { state.withLock { $0.exchanges } }

    // MARK: the seam

    public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let url = request.url.hasPrefix(base) ? String(request.url.dropFirst(base.count)) : request.url
        let parts = url.split(separator: "?", maxSplits: 1).map(String.init)
        let path = parts.first ?? ""
        let query = parts.count > 1 ? parseQuery(parts[1]) : [:]
        let body = request.body.flatMap { JSONValue.parse($0) }
        let (status, answer, delta) = route(request.method, path, query, body)
        state.withLock { $0.exchanges.append(StubExchange(method: request.method, path: path, query: query, status: status, body: body)) }
        if let delta { broadcast(delta) }
        return HTTPResponse(status: status, body: answer ?? Data())
    }

    private func json<T: Encodable>(_ value: T) -> (Int, Data?, Delta?) {
        // The contract types always encode; a failure here is a bug in this file.
        (200, try? Wire.encode(value), nil)
    }

    private static let none: (Int, Data?, Delta?) = (204, nil, nil)
    private static let missing: (Int, Data?, Delta?) = (404, nil, nil)

    private func route(_ method: String, _ path: String, _ query: [String: String], _ body: JSONValue?) -> (Int, Data?, Delta?) {
        let segments = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard segments.count >= 2, segments[0] == "api", segments[1] == "seam" else { return Self.missing }
        let rest = Array(segments.dropFirst(2))

        switch (method, rest.first, rest.count) {
        case ("GET", "sessions", 1):
            return json(state.withLock { stored in
                StubWorld.sessions.compactMap { stored.sessions[$0.id]?.summary }
            })
        case ("GET", "sessions", 2) where rest[1] == "recent-repos":
            return json([RecentRepo]())
        case (_, "sessions", _) where rest.count >= 2:
            return session(method, rest[1], Array(rest.dropFirst(2)), query, body)

        case ("GET", "connections", 2) where rest[1] == "candidates":
            return json(StubWorld.models)
        case ("GET", "connections", 1):
            return json([ConnectionSummary(id: "c1", kind: .anthropic, displayName: "Anthropic", createdAt: StubWorld.morning, enabled: true)])
        case ("GET", "user-config", 2) where rest[1] == "facet-catalog":
            return json(StubWorld.facets)
        case ("GET", "nodes", 1), ("GET", "channels", 1), ("GET", "skills", 1), ("GET", "memory", 1), ("GET", "mcp", 1):
            return json([JSONValue]())
        case ("GET", "git", 2) where rest[1] == "repos":
            return json(GitRepoListing(repos: [GitRepoRow(fullName: "sand/slopcoder", cloneUrl: "https://git.example/sand/slopcoder.git")]))
        case ("GET", "git", 2) where rest[1] == "connections":
            return json([JSONValue]())
        case ("GET", "git-identity", 1):
            return json(GitIdentityPrefs(name: "Stub Person", email: "stub@example.invalid"))
        case ("GET", "protocol", 1):
            return json(ServerProtocol(version: "stub"))
        case ("GET", "session-search", 1):
            return json([SessionSearchHit]())

        case ("GET", "automations", 2) where rest[1] == "status":
            return json(RoutineStatus(
                anyRoutines: true, upcoming: [NextFire(routineId: StubWorld.routineId, name: StubWorld.routine.name, at: "2026-11-28T07:00:00Z")]
            ))
        case ("GET", "automations", 2) where rest[1] == "board":
            return json(RoutineBoard(routines: [RoutineCard(
                id: StubWorld.routineId, name: StubWorld.routine.name, kind: .job, enabled: true, scheduleEnabled: true,
                scheduleSentence: "every weekday at 7am", nextFire: "2026-11-28T07:00:00Z"
            )]))
        case ("GET", "automations", 1):
            return json([StubWorld.routine])
        case ("GET", "automations", 3) where rest[1] == StubWorld.routineId && rest[2] == "detail":
            return json(RoutineDetail(routine: StubWorld.routine, scheduleSentence: "every weekday at 7am", notifiesLabel: "this phone"))

        case ("GET", "artifacts", 1):
            return json([StubWorld.artifact])
        case ("GET", "artifacts", 2) where rest[1] == StubWorld.artifactId:
            return json(ArtifactDetail(artifact: StubWorld.artifact, text: "# Why the upload test was flaky\n\nIt raced its own completion handler."))

        default:
            return Self.missing
        }
    }

    private func session(_ method: String, _ id: String, _ rest: [String], _ query: [String: String], _ body: JSONValue?) -> (Int, Data?, Delta?) {
        guard let current = state.withLock({ $0.sessions[id] }) else { return Self.missing }
        switch (method, rest.first, rest.count) {
        case ("GET", nil, 0):
            return json(current.state)
        case ("GET", "scrollback", 1):
            let from = max(0, Int(query["from"] ?? "0") ?? 0)
            let take = Int(query["take"] ?? "0") ?? 0
            let end = take == 0 ? current.events.count : min(current.events.count, from + take)
            return json(from < end ? Array(current.events[from..<end]) : [])
        case ("POST", "presence", 1), ("POST", "stop", 1):
            return Self.none
        case ("GET", "slash", 1):
            return json([SlashCommandInfo]())
        case ("GET", "workspace", 2) where rest[1] == "changes":
            return json([SessionModel.WorkspaceRepo(repo: "slopcoder", branch: "fix-upload-race")])
        case ("POST", "start", 1):
            return answer(id, prompt: body?["prompt"].string, steering: false)
        case ("POST", "steer", 1):
            // As on the server: there is nothing to steer once the turn is over.
            guard current.summary.status == .running else { return Self.missing }
            return answer(id, prompt: body?["prompt"].string, steering: true)
        default:
            return Self.missing
        }
    }

    /// The prompt lands, the agent answers, the turn closes.
    private func answer(_ id: String, prompt: String?, steering: Bool) -> (Int, Data?, Delta?) {
        guard let prompt, !prompt.isEmpty else { return (400, nil, nil) }
        let delta: Delta? = state.withLock { stored -> Delta? in
            guard var session = stored.sessions[id] else { return nil }
            let first = session.events.count
            let at = Date().ISO8601Format()
            let added = [
                StubWorld.event(first, steering ? "SteeringPrompt" : "UserPrompt", ["text": .string(prompt), "at": .string(at)]),
                StubWorld.event(first + 1, "AssistantText", ["text": .string(StubWorld.reply), "at": .string(at)]),
                StubWorld.event(first + 2, "TurnCompleted", ["durationMs": 1_200]),
            ]
            session.events += added
            stored.sessions[id] = session
            return Delta(sessionId: id, state: session.state, events: added)
        }
        return delta == nil ? Self.missing : (204, nil, delta)
    }

    // MARK: the hub

    struct Delta: Sendable {
        var sessionId: String
        var state: SessionState
        var events: [AgentEventEnvelope]
    }

    public func connect(baseUrl: String, apiKey: String) async throws -> HubSocket {
        let socket = StubHubSocket(server: self)
        state.withLock { $0.sockets.append(socket) }
        return socket
    }

    /// The seed `Subscribe` answers with.
    func seed(_ sessionId: String) -> SessionState? {
        state.withLock { $0.sessions[sessionId]?.state }
    }

    func closed(_ socket: StubHubSocket) {
        state.withLock { $0.sockets.removeAll { $0 === socket } }
    }

    private func broadcast(_ delta: Delta) {
        guard let stateJSON = try? Wire.encode(delta.state), let eventsJSON = try? Wire.encode(delta.events),
              let seed = JSONValue.parse(stateJSON), let events = JSONValue.parse(eventsJSON)
        else { return }
        let frame = JSONValue.object([
            "type": 1,
            "target": "Delta",
            "arguments": [.string(delta.sessionId), seed, events, .null],
        ]).serialized() + String(HubProtocol.separator)
        for socket in state.withLock({ $0.sockets }) where socket.watches(delta.sessionId) { socket.push(frame) }
    }
}

/// One hub connection to the stub: the handshake, `Subscribe` answered with
/// the session's state, and whatever the server pushes after.
final class StubHubSocket: HubSocket {
    private struct State: Sendable {
        var inbox: [String] = []
        var waiter: CheckedContinuation<String, Error>?
        var watching: Set<String> = []
        var closed = false
    }

    private let state = Locked(State())
    private weak let server: StubServer?

    init(server: StubServer) {
        self.server = server
    }

    func watches(_ sessionId: String) -> Bool { state.withLock { $0.watching.contains(sessionId) } }

    func push(_ frame: String) {
        let waiting: CheckedContinuation<String, Error>? = state.withLock { state in
            if state.closed { return nil }
            if let waiter = state.waiter {
                state.waiter = nil
                return waiter
            }
            state.inbox.append(frame)
            return nil
        }
        waiting?.resume(returning: frame)
    }

    func send(_ text: String) async throws {
        if text == HubProtocol.handshake {
            push("{}" + String(HubProtocol.separator))
            return
        }
        for record in HubProtocol.records(text) {
            guard let json = JSONValue.parse(record), json["type"].int == 1 else { continue }
            let id = json["invocationId"].stringValue
            let sessionId = json["arguments"].arrayValue.first?.string ?? ""
            var result = JSONValue.null
            switch json["target"].string {
            case "Subscribe":
                state.withLock { _ = $0.watching.insert(sessionId) }
                if let seed = server?.seed(sessionId), let data = try? Wire.encode(seed), let value = JSONValue.parse(data) {
                    result = value
                }
            case "Unsubscribe":
                state.withLock { _ = $0.watching.remove(sessionId) }
            default:
                break
            }
            push(JSONValue.object(["type": 3, "invocationId": .string(id), "result": result]).serialized() + String(HubProtocol.separator))
        }
    }

    func receive() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let ready: Result<String, Error>? = state.withLock { state in
                if state.closed { return .failure(HubError("The connection was closed.")) }
                if !state.inbox.isEmpty { return .success(state.inbox.removeFirst()) }
                state.waiter = continuation
                return nil
            }
            if let ready { continuation.resume(with: ready) }
        }
    }

    func close() {
        let waiting: CheckedContinuation<String, Error>? = state.withLock { state in
            state.closed = true
            let waiter = state.waiter
            state.waiter = nil
            return waiter
        }
        waiting?.resume(throwing: HubError("The connection was closed."))
        server?.closed(self)
    }
}
