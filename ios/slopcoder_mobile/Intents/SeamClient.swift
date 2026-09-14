import Foundation

/// The seam, in Swift.
///
/// A deliberate second implementation rather than a bridge to the TypeScript
/// one. Siri can run an intent without launching the app, and booting the React
/// Native runtime to make two HTTP calls would be slow and would fail in ways
/// that are hard to explain to someone holding a phone. What this duplicates is
/// small and pinned by the same facts documented in `src/api/seam.ts`:
///
/// - `X-Slopcoder-Client` on every mutation, or `SameOriginFilter` answers 403
///   with no body.
/// - Enums are integers; `SessionStatus.running` is 1.
/// - Omitting `clientWorkspace` is what makes a session server-sandboxed, which
///   is the only kind a phone can start.
struct SeamClient {
    let credential: Credential

    // MARK: wire types

    struct SessionSummary: Decodable {
        let id: String
        let title: String
        let model: String
        let autoRoute: Bool
        let status: Int
        /// Kept as a string: nothing here needs a Date, and ISO8601 with an
        /// offset is more trouble to decode than it is worth.
        let createdAt: String
    }

    struct SessionState: Decodable {
        let title: String
        let status: Int
        let pendingApprovalIds: [String]
        let pendingQuestionIds: [String]
        let lastUsage: UsageReport?
        let usage: UsageSummary
    }

    struct UsageReport: Decodable {
        let inputTokens: Int
        let cacheReadInputTokens: Int
        let cacheCreationInputTokens: Int
        let contextWindowTokens: Int

        var percentOfContext: Int? {
            guard contextWindowTokens > 0 else { return nil }
            let prompt = inputTokens + cacheReadInputTokens + cacheCreationInputTokens
            return min(100, Int((100.0 * Double(prompt) / Double(contextWindowTokens)).rounded()))
        }
    }

    struct UsageSummary: Decodable {
        let estimatedCost: Double?
    }

    private struct ModelSelection: Encodable {
        let auto: Bool
        let connectionId: String?
        let modelId: String?

        static let autoRoute = ModelSelection(auto: true, connectionId: nil, modelId: nil)
    }

    /// `clientWorkspace` is absent on purpose — see the note above.
    private struct CreateSessionRequest: Encodable {
        let selection: ModelSelection
        let initialPrompt: String
        let repoUrls: [String]?
    }

    private struct CreateSessionResult: Decodable {
        let id: String?
    }

    private struct StartSessionRequest: Encodable {
        let prompt: String
        let selection: ModelSelection
    }

    private struct PushSubscribeRequest: Encodable {
        let endpoint: String
        let p256dh: String
        let auth: String
    }

    private struct PushUnsubscribeRequest: Encodable {
        let endpoint: String
    }

    // MARK: transport

    private func request(_ method: String, _ path: String, body: Data? = nil) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: credential.server) else {
            throw IntentError.unreachable
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("Bearer \(credential.apiKey)", forHTTPHeaderField: "Authorization")
        // Required on every non-GET, bearer callers included.
        request.setValue("1", forHTTPHeaderField: "X-Slopcoder-Client")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw IntentError.unreachable
        }

        guard let http = response as? HTTPURLResponse else { throw IntentError.unreachable }
        guard (200..<300).contains(http.statusCode) else { throw IntentError.server(http.statusCode) }
        return data
    }

    private func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await send(try request("GET", path)))
    }

    // MARK: calls

    func sessions() async throws -> [SessionSummary] {
        try await get("api/seam/sessions/", as: [SessionSummary].self)
    }

    func state(of id: String) async throws -> SessionState {
        try await get("api/seam/sessions/\(id)", as: SessionState.self)
    }

    /// Subscribe this phone the way a browser would: the endpoint the relay gave
    /// it, and the keys it made. Called on every launch, because the APNs token
    /// behind the endpoint is not stable across reinstalls, restores or OS
    /// upgrades, and a new token means a new endpoint.
    func subscribePush(endpoint: String, p256dh: String, auth: String) async throws {
        let body = PushSubscribeRequest(endpoint: endpoint, p256dh: p256dh, auth: auth)
        _ = try await send(try request("POST", "api/seam/push/subscribe", body: try JSONEncoder().encode(body)))
    }

    func unsubscribePush(endpoint: String) async throws {
        let body = PushUnsubscribeRequest(endpoint: endpoint)
        _ = try await send(try request("POST", "api/seam/push/unsubscribe", body: try JSONEncoder().encode(body)))
    }

    func recentRepos(take: Int = 6) async throws -> [String] {
        try await get("api/seam/sessions/recent-repos?take=\(take)", as: [String].self)
    }

    /// Create, then start. Two calls because create is cheap and synchronous
    /// while the turn is neither; the server hands back an id immediately and
    /// the work proceeds without us.
    func startSession(prompt: String, repoUrls: [String]?) async throws -> String {
        let create = CreateSessionRequest(
            selection: .autoRoute,
            initialPrompt: prompt,
            repoUrls: repoUrls?.isEmpty == false ? repoUrls : nil
        )
        let created = try JSONDecoder().decode(
            CreateSessionResult.self,
            from: try await send(try request("POST", "api/seam/sessions/", body: try JSONEncoder().encode(create)))
        )

        // A null id means the model selection did not resolve — with auto-route
        // that means the account has no usable model at all.
        guard let id = created.id else { throw IntentError.noModel }

        let start = StartSessionRequest(prompt: prompt, selection: .autoRoute)
        _ = try await send(try request("POST", "api/seam/sessions/\(id)/start", body: try JSONEncoder().encode(start)))
        return id
    }
}
