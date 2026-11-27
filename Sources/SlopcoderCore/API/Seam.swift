// The HTTP half of the client, ported from `src/SlopCoder.Client/SeamHttpClient.cs`.
//
// Three behaviours are load-bearing and none of them are obvious:
//
// - **`X-Slopcoder-Client` on every mutation.** `SameOriginFilter` guards the
//   whole `/api/seam` group and answers a missing header with a bare 403 and no
//   body. It applies to bearer-key callers too, not just browsers.
// - **404 means nil, not failure.** The seam returns it for "no such session"
//   and for "not yours", deliberately indistinguishable.
// - **401 means the credential died.** `/api` and `/hubs` answer with a bare
//   401 rather than redirecting to the login page, precisely so a programmatic
//   client can act on it. Signing out is the only correct response.

import Foundation

/// The header `SameOriginFilter` demands. Any value works; the web client sends "1".
public let clientHeader = "X-Slopcoder-Client"

/// Thrown when the server rejects our key. The app signs out rather than retrying.
public struct SignedOutError: Error, LocalizedError, Equatable {
    public init() {}
    public var errorDescription: String? { "The server rejected this device’s key." }
}

/// The server could not be reached at all — no DNS, no route, no listener, or the
/// phone has no network.
///
/// Distinct from `SeamError` on purpose: a 500 means slopcoder is there and
/// unhappy, and the two want different words and different remedies. The
/// classification has to happen here or every screen ends up showing a raw
/// `URLError`.
public struct OfflineError: Error, LocalizedError, Equatable {
    public init() {}
    public var errorDescription: String? { "Could not reach slopcoder." }
}

public struct SeamError: Error, LocalizedError, Equatable {
    public let status: Int
    public let message: String

    public init(status: Int, message: String) {
        self.status = status
        self.message = message
    }

    public var errorDescription: String? { message }
}

/// What a person should read when a call failed.
public func describe(_ error: Error) -> String {
    (error as? LocalizedError)?.errorDescription ?? String(describing: error)
}

public final class Seam: Sendable {
    public let baseUrl: String
    public let apiKey: String
    private let transport: HTTPTransport
    /// Called once when a 401 proves the key is dead.
    private let onSignedOut: (@Sendable () -> Void)?
    /// Reachability, reported from whether calls actually complete rather than
    /// from the OS. A phone with full bars and no route to this server is offline
    /// as far as anything here is concerned.
    private let onReachable: (@Sendable (Bool) -> Void)?

    public init(
        baseUrl: String,
        apiKey: String,
        transport: HTTPTransport = URLSessionTransport(),
        onSignedOut: (@Sendable () -> Void)? = nil,
        onReachable: (@Sendable (Bool) -> Void)? = nil
    ) {
        self.baseUrl = trimTrailingSlashes(baseUrl)
        self.apiKey = apiKey
        self.transport = transport
        self.onSignedOut = onSignedOut
        self.onReachable = onReachable
    }

    // MARK: - transport

    /// The headers an owner-only fetch outside the seam needs (artifact bytes,
    /// tool images): the bearer key, and the client header for good measure.
    public var authHeaders: [String: String] {
        ["Authorization": "Bearer \(apiKey)", clientHeader: "1"]
    }

    /// The one place a status is interpreted. Callers get the code back as well as
    /// the body, because 404 means different things to a read and to a command and
    /// collapsing both to nil loses that.
    func requestRaw(_ method: String, _ path: String, body: Data? = nil) async throws -> (status: Int, body: Data?) {
        // GET and HEAD are exempt from the filter, but sending it always is what
        // the reference client does and costs nothing.
        var headers = authHeaders
        if body != nil { headers["Content-Type"] = "application/json" }

        let response: HTTPResponse
        do {
            response = try await transport.send(
                HTTPRequest(method: method, url: "\(baseUrl)/\(path)", headers: headers, body: body)
            )
        } catch {
            // A cancelled request is the caller changing its mind, not a dead server.
            if isCancellation(error) { throw CancellationError() }
            onReachable?(false)
            throw OfflineError()
        }

        // Anything with a status code means we got there, whatever it says.
        onReachable?(true)

        if response.status == 401 {
            onSignedOut?()
            throw SignedOutError()
        }
        if response.status == 404 { return (404, nil) }
        if !response.ok {
            throw SeamError(status: response.status, message: "\(method) \(path) failed: \(response.status)")
        }
        if response.status == 204 || response.body.isEmpty { return (response.status, nil) }
        return (response.status, response.body)
    }

    private func request<T: Decodable>(
        _ type: T.Type = T.self,
        _ method: String,
        _ path: String,
        body: Data? = nil
    ) async throws -> (status: Int, value: T?) {
        let (status, data) = try await requestRaw(method, path, body: body)
        guard let data else { return (status, nil) }
        // `null` is a body too, and decodes to nothing.
        return (status, try? Wire.decode(T.self, from: data))
    }

    private func encode<B: Encodable>(_ body: B) throws -> Data {
        try Wire.encode(body)
    }

    private static let emptyBody = Data("{}".utf8)

    func send<T: Decodable>(_ type: T.Type = T.self, _ method: String, _ path: String) async throws -> T? {
        try await request(T.self, method, path).value
    }

    func send<T: Decodable, B: Encodable>(_ type: T.Type = T.self, _ method: String, _ path: String, _ body: B) async throws -> T? {
        try await request(T.self, method, path, body: encode(body)).value
    }

    /// A write whose answer carries nothing worth reading.
    func sendVoid<B: Encodable>(_ method: String, _ path: String, _ body: B) async throws {
        _ = try await requestRaw(method, path, body: encode(body))
    }

    public func get<T: Decodable>(_ type: T.Type = T.self, _ path: String) async throws -> T? {
        try await request(T.self, "GET", path).value
    }

    /// True when the command landed. A 404 is false, not an error: the session is
    /// gone, the turn already ended, or the approval was answered elsewhere — all
    /// things the caller must handle rather than treat as success.
    public func post(_ path: String) async throws -> Bool {
        try await requestRaw("POST", path, body: Seam.emptyBody).status != 404
    }

    public func post<B: Encodable>(_ path: String, _ body: B) async throws -> Bool {
        try await requestRaw("POST", path, body: encode(body)).status != 404
    }

    /// A command that answers with a validation problem rather than throwing.
    ///
    /// The routines seam returns `TextResult` — `{value}` — where a null value
    /// means it worked and a string is the sentence to show. A bare null body
    /// would be ambiguous with an empty 204, which is why the server wraps it; the
    /// 404 is ours to word, since the seam deliberately cannot tell "no such
    /// routine" from "not yours".
    private func problem(_ path: String, _ body: JSONValue = [:]) async throws -> String? {
        try await textResult("POST", path, body, gone: "That routine is gone.")
    }

    /// The same `{value}` answer, from any settings command. The seam answers a
    /// 404 for "no such row" and "not yours" alike, so the sentence is ours.
    private func textResult<B: Encodable>(_ method: String, _ path: String, _ body: B, gone: String) async throws -> String? {
        let (status, value) = try await request(TextResult.self, method, path, body: encode(body))
        if status == 404 { return gone }
        return value?.value
    }

    /// A command that answers 204 or 404 and nothing else: true when it landed.
    /// A PUT, mostly — the settings pages flip switches with these.
    private func landed(_ method: String, _ path: String, _ body: JSONValue = [:]) async throws -> Bool {
        try await requestRaw(method, path, body: encode(body)).status != 404
    }

    /// Null means attached; a returned sentence is the server's validation error.
    public func addSessionRepository(_ id: String, url: String) async throws -> String? {
        try await textResult(
            "POST", "api/seam/sessions/\(encodeURIComponent(id))/workspace/repos",
            ["url": .string(url)] as JSONValue, gone: "That session is gone."
        )
    }

    // MARK: - sessions

    public func sessions() async throws -> [SessionSummary] {
        try await get([SessionSummary].self, "api/seam/sessions/") ?? []
    }

    public func session(_ id: String) async throws -> SessionState? {
        try await get(SessionState.self, "api/seam/sessions/\(id)")
    }

    /// `take: 0` means no limit. The tail window the cockpit opens with is
    /// `from = nextOrdinal - window`; gap pulls use the local cursor.
    public func scrollback(_ id: String, from: Int, take: Int = 0) async throws -> [AgentEventEnvelope] {
        try await get([AgentEventEnvelope].self, "api/seam/sessions/\(id)/scrollback?from=\(from)&take=\(take)") ?? []
    }

    /// Creating is cheap and synchronous; starting the turn is not. Hence two calls.
    public func createSession(_ request: CreateSessionRequest) async throws -> String? {
        try await send(CreateSessionResult.self, "POST", "api/seam/sessions/", request)?.id
    }

    public func start(_ id: String, _ request: StartSessionRequest) async throws -> Bool {
        try await post("api/seam/sessions/\(id)/start", request)
    }

    /// False when no turn is in flight — the caller should start one instead.
    public func steer(_ id: String, _ request: SteerRequest) async throws -> Bool {
        try await post("api/seam/sessions/\(id)/steer", request)
    }

    public func stop(_ id: String) async throws -> Bool {
        try await post("api/seam/sessions/\(id)/stop")
    }

    /// Bumps the idle clock and respawns a stopped container in the background.
    /// The reaper stops idle sandboxes, so a viewer that never says it is here
    /// makes the next prompt pay a cold start.
    @discardableResult
    public func presence(_ id: String) async throws -> Bool {
        try await post("api/seam/sessions/\(id)/presence")
    }

    // MARK: - slash commands
    //
    // Parsing happens here (`Slash.swift`), running happens there: the commands
    // want the sandbox, the facet catalogue and the live model.

    /// Every command this session offers — the built-ins, plus whatever
    /// `.slopcoder/commands/*.md` each attached repository defines.
    ///
    /// Reading the repo templates walks the sandbox, so this is asked for the
    /// first time a slash is typed rather than when the screen opens: a session
    /// nobody runs a command in never wakes a container to list them.
    ///
    /// The group is mapped at `/slash/` — without the trailing slash it is a 404.
    public func slashCommands(_ id: String) async throws -> [SlashCommandInfo] {
        try await get([SlashCommandInfo].self, "api/seam/sessions/\(id)/slash/") ?? []
    }

    /// Runs it, and answers with the prompt to send when a repo template expanded.
    ///
    /// Nil covers three things the caller treats alike — a command that handled
    /// itself (204), a session that is gone or not ours (404), and an input the
    /// server did not read as a command at all. In every one of them there is
    /// nothing left to send; what the command had to say is already in the
    /// scrollback.
    public func runSlashCommand(_ id: String, input: String) async throws -> SlashResult? {
        try await send(SlashResult.self, "POST", "api/seam/sessions/\(id)/slash/", ["input": .string(input)] as JSONValue)
    }

    public func approve(_ id: String, _ request: ResolveApprovalRequest) async throws -> Bool {
        try await post("api/seam/sessions/\(id)/approvals", request)
    }

    public func answer(_ id: String, _ request: ResolveQuestionRequest) async throws -> Bool {
        // A dismissal is `answers: null`, said out loud rather than left out.
        var body: [String: JSONValue] = ["requestId": .string(request.requestId), "answers": .null]
        if let answers = request.answers {
            body["answers"] = .array(answers.map { ["question": .string($0.question), "answer": .string($0.answer)] })
        }
        return try await post("api/seam/sessions/\(id)/questions", JSONValue.object(JSONObject(body)))
    }

    public func rename(_ id: String, name: String) async throws {
        try await sendVoid("PUT", "api/seam/sessions/\(id)/name", ["name": .string(name)] as JSONValue)
    }

    public func setThinking(_ id: String, level: ThinkingLevel?) async throws {
        try await sendVoid(
            "PUT", "api/seam/sessions/\(id)/thinking",
            ["level": level.map { .number(Double($0.rawValue)) } ?? .null] as JSONValue
        )
    }

    public func setApprovalMode(_ id: String, _ request: SetApprovalRequest) async throws {
        try await sendVoid("PUT", "api/seam/sessions/\(id)/approval-mode", request)
    }

    public func setFacet(_ id: String, facetName: String?) async throws {
        try await sendVoid(
            "PUT", "api/seam/sessions/\(id)/facet",
            ["facetName": facetName.map(JSONValue.string) ?? .null] as JSONValue
        )
    }

    /// Nil when the session was already gone.
    public func deleteSession(_ id: String) async throws -> DeleteResult? {
        struct Answer: Decodable { let result: Int? }
        let answer = try await request(Answer.self, "DELETE", "api/seam/sessions/\(id)").value
        return answer?.result.map(DeleteResult.init(rawValue:))
    }

    // MARK: - catalogs

    public func models() async throws -> [ModelCandidate] {
        try await get([ModelCandidate].self, "api/seam/connections/candidates") ?? []
    }

    public func facets() async throws -> [FacetOption] {
        try await get([FacetOption].self, "api/seam/user-config/facet-catalog") ?? []
    }

    /// Labeled rows — owner/name and the forge mark — since the seam grew them.
    public func recentRepos(take: Int = 6) async throws -> [RecentRepo] {
        try await get([RecentRepo].self, "api/seam/sessions/recent-repos?take=\(take)") ?? []
    }

    public func repos() async throws -> GitRepoListing {
        try await get(GitRepoListing.self, "api/seam/git/repos") ?? GitRepoListing()
    }

    /// A bare array, not a listing. `/git/repos` answers `{repos, errors}` because
    /// a fan-out can half-fail; `/git/repos/search` is best-effort and answers the
    /// rows alone (`SeamEndpoints.cs`, `IGitApi.SearchRepositoriesAsync`). Reading
    /// it as a listing meant every search came back empty and the attach sheet
    /// only ever showed recent sessions' repositories.
    public func searchRepos(_ query: String) async throws -> [GitRepoRow] {
        try await get([GitRepoRow].self, "api/seam/git/repos/search?q=\(encodeURIComponent(query))") ?? []
    }

    public func nodes() async throws -> [RemoteNodeSummary] {
        try await get([RemoteNodeSummary].self, "api/seam/nodes/") ?? []
    }

    /// Every channel connection the caller owns: what a trigger listens on, where an answer goes.
    public func channels() async throws -> [ChannelSummary] {
        try await get([ChannelSummary].self, "api/seam/channels/") ?? []
    }

    // MARK: - routines
    //
    // The paths still say `automations`: the entities kept that name and the
    // screens took the new one (`docs/general-assistant.md`). Every read here is
    // already folded server-side, so a screen is one call and no arithmetic.

    /// `?tz=Europe/Berlin`, or nothing at all when the phone could not name its zone.
    private func zone(_ timeZoneId: String?) -> String {
        guard let timeZoneId, !timeZoneId.isEmpty else { return "" }
        return "?tz=\(encodeURIComponent(timeZoneId))"
    }

    /// The whole board. `tz` is the phone's own zone, which is what "today" is
    /// counted in — leave it off and the server counts in UTC, which is somebody
    /// else's midnight. A 404 means the user has nothing, not that we failed.
    public func routineBoard(tz: String? = nil) async throws -> RoutineBoard {
        try await get(RoutineBoard.self, "api/seam/automations/board\(zone(tz))") ?? RoutineBoard()
    }

    /// The cheap read behind the sessions screen's strip.
    public func routineStatus(tz: String? = nil) async throws -> RoutineStatus {
        try await get(RoutineStatus.self, "api/seam/automations/status\(zone(tz))") ?? RoutineStatus()
    }

    /// Nil when it is not the caller's, which is indistinguishable from gone.
    public func routine(_ id: String) async throws -> RoutineDetail? {
        try await get(RoutineDetail.self, "api/seam/automations/\(id)/detail")
    }

    public func routineRuns(_ id: String, skip: Int, take: Int) async throws -> RunPage {
        try await get(RunPage.self, "api/seam/automations/\(id)/runs/page?skip=\(skip)&take=\(take)") ?? RunPage()
    }

    public func routineRun(_ id: String, runId: String) async throws -> RunDetail? {
        try await get(RunDetail.self, "api/seam/automations/\(id)/runs/\(runId)")
    }

    public func setRoutineEnabled(_ id: String, enabled: Bool) async throws -> String? {
        try await problem("api/seam/automations/\(id)/enabled/\(enabled)")
    }

    /// Start a run right now, ignoring active hours.
    public func runRoutineNow(_ id: String) async throws -> String? {
        try await problem("api/seam/automations/\(id)/run")
    }

    /// Run it again, recording the new run as this one's retry.
    public func retryRoutineRun(_ id: String, runId: String) async throws -> String? {
        try await problem("api/seam/automations/\(id)/runs/\(runId)/retry")
    }

    public func setTriggerEnabled(_ id: String, triggerId: String, enabled: Bool) async throws -> String? {
        try await problem("api/seam/automations/\(id)/triggers/\(triggerId)/enabled/\(enabled)")
    }

    /// Start a manual run tagged with one trigger, as if it had fired.
    public func fireTrigger(_ id: String, triggerId: String) async throws -> String? {
        try await problem("api/seam/automations/\(id)/triggers/\(triggerId)/fire")
    }

    public func setRoutinePrompt(_ id: String, prompt: String) async throws -> String? {
        try await problem("api/seam/automations/\(id)/prompt", ["value": .string(prompt)])
    }

    /// Replace the agent-maintained scratch the heartbeat watches.
    public func setRoutineNotepad(_ id: String, notepad: String) async throws -> String? {
        try await problem("api/seam/automations/\(id)/notepad", ["value": .string(notepad)])
    }

    /// False when it was already gone, or was never the caller's.
    public func deleteRoutine(_ id: String) async throws -> Bool {
        try await requestRaw("DELETE", "api/seam/automations/\(id)").status != 404
    }

    /// The caller's heartbeat, creating it — paused, on the default schedule — the
    /// first time anyone asks. At most one exists per user, so this is safe to
    /// call from a button that says "set it up".
    public func heartbeat() async throws -> AutomationSummary? {
        try await send(AutomationSummary.self, "POST", "api/seam/automations/heartbeat", [:] as JSONValue)
    }

    // MARK: - authoring
    //
    // A create or an update answers with a result rather than a TextResult: a
    // write may mint a webhook secret, and that is the one moment it is ever
    // readable. `error` nil means it worked.

    /// A write that came back with no body at all, which a save never should.
    static let saveUnanswered = AutomationSaveResult(error: "The server did not say whether that was saved.", webhooks: [])
    static let saveGone = AutomationSaveResult(error: "That routine is gone.", webhooks: [])

    /// Every routine, in the editable shape.
    public func routines() async throws -> [AutomationSummary] {
        try await get([AutomationSummary].self, "api/seam/automations/") ?? []
    }

    public func createRoutine(_ draft: AutomationDraft) async throws -> AutomationSaveResult {
        try await send(AutomationSaveResult.self, "POST", "api/seam/automations/", draft) ?? Seam.saveUnanswered
    }

    /// A 404 is worded here: the seam cannot tell "no such routine" from "not yours".
    public func updateRoutine(_ id: String, _ draft: AutomationDraft) async throws -> AutomationSaveResult {
        let (status, value) = try await request(AutomationSaveResult.self, "PUT", "api/seam/automations/\(id)", body: encode(draft))
        if status == 404 { return Seam.saveGone }
        return value ?? Seam.saveUnanswered
    }

    /// Mint a fresh secret for one webhook trigger, invalidating the old one at
    /// once. The URL keeps its trigger id; what changes is the credential.
    public func rotateWebhookSecret(_ id: String, triggerId: String) async throws -> AutomationSaveResult {
        let (status, value) = try await request(
            AutomationSaveResult.self, "POST", "api/seam/automations/\(id)/webhooks/\(triggerId)/rotate", body: Seam.emptyBody
        )
        if status == 404 { return Seam.saveGone }
        return value ?? Seam.saveUnanswered
    }

    /// Read a typed schedule as a cron, server-side and deterministically, so the
    /// ✓ line says the same thing whether the schedule was drafted or typed.
    public func parseSchedule(_ text: String, timeZoneId: String? = nil) async throws -> ScheduleParse {
        let body: JSONValue = ["text": .string(text), "timeZoneId": timeZoneId.map(JSONValue.string) ?? .null]
        return try await send(ScheduleParse.self, "POST", "api/seam/automations/schedule", body)
            ?? ScheduleParse(ok: false, error: "the server did not answer")
    }

    /// Draft a routine from a description. Never throws for a model's failure; see `ok`.
    public func draftRoutine(_ description: String, timeZoneId: String? = nil) async throws -> RoutineDraftResult {
        let body: JSONValue = ["description": .string(description), "timeZoneId": timeZoneId.map(JSONValue.string) ?? .null]
        return try await send(RoutineDraftResult.self, "POST", "api/seam/automations/draft", body)
            ?? RoutineDraftResult(ok: false, error: "The server did not answer.", deliveryKind: DeliveryKind(rawValue: 1))
    }

    // MARK: - usage

    public func usage(_ range: UsageRange) async throws -> UsageDashboard? {
        try await get(UsageDashboard.self, "api/seam/usage?range=\(range.name ?? String(range.rawValue))")
    }

    /// Advisory Codex allowances; `refresh` asks the upstream again rather than serving the cache.
    public func codexQuotas(refresh: Bool = false) async throws -> [CodexQuotaSummary] {
        try await get([CodexQuotaSummary].self, "api/seam/usage/codex-quotas?refresh=\(refresh)") ?? []
    }

    /// Every subscription connection's allowance, Codex and Claude Code alike.
    /// A server from before Claude plans were listed answers 404 here; it still
    /// has the Codex-only route, so that is asked instead and read as Codex rows —
    /// a phone is routinely newer than the server it talks to.
    public func planQuotas(refresh: Bool = false) async throws -> [PlanQuotaSummary] {
        let (status, data) = try await requestRaw("GET", "api/seam/usage/plan-quotas?refresh=\(refresh)")
        if status != 404 {
            guard let data else { return [] }
            return (try? Wire.decode([PlanQuotaSummary].self, from: data)) ?? []
        }
        // Read the Codex rows through the wider type: the two share every field
        // but the two set here.
        let (_, legacy) = try await requestRaw("GET", "api/seam/usage/codex-quotas?refresh=\(refresh)")
        guard let legacy, var rows = try? Wire.decode([PlanQuotaSummary].self, from: legacy) else { return [] }
        for index in rows.indices {
            rows[index].kind = .openAICodex
            rows[index].canRefresh = true
        }
        return rows
    }

    /// Full-text search over the caller's own past sessions — what was said, not titles.
    public func sessionSearch(_ query: String, limit: Int = 10) async throws -> [SessionSearchHit] {
        try await get([SessionSearchHit].self, "api/seam/session-search?query=\(encodeURIComponent(query))&limit=\(limit)") ?? []
    }

    public func serverProtocol() async throws -> ServerProtocol? {
        try await get(ServerProtocol.self, "api/seam/protocol")
    }

    /// The cheap "is this key still good" probe the terminal client runs at startup.
    public func probe() async -> Bool {
        (try? await sessions()) != nil
    }

    // MARK: - settings
    //
    // One method per call the web's settings pages make, over the same
    // `/api/seam/*` groups (`Http*Api.cs`). A create answers `{id, error}`; an
    // update or a command answers `{value}` with null for success; a switch
    // answers 204 or 404. Nothing here ever reads a secret back.

    private static let unanswered = "The server did not answer."

    // -- connections --

    public func connections() async throws -> [ConnectionSummary] {
        try await get([ConnectionSummary].self, "api/seam/connections/") ?? []
    }

    /// The key is validated against the provider before it is stored; the error says why not.
    public func createConnection(_ request: CreateConnectionRequest) async throws -> CreateResult {
        try await send(CreateResult.self, "POST", "api/seam/connections/", request) ?? CreateResult(id: nil, error: Seam.unanswered)
    }

    public func deleteConnection(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/connections/\(id)")
    }

    /// Resolved server-side with the decrypted key; only names come back.
    public func connectionModels(_ id: String) async throws -> [ModelOption] {
        try await get([ModelOption].self, "api/seam/connections/\(id)/models") ?? []
    }

    public func connectionTiers(_ id: String) async throws -> [String: ModelTier] {
        try await get([String: ModelTier].self, "api/seam/connections/\(id)/tiers") ?? [:]
    }

    /// Nil clears the grade back to the catalog's default.
    public func setModelTier(_ id: String, modelId: String, tier: ModelTier?) async throws -> Bool {
        try await landed("PUT", "api/seam/connections/\(id)/tiers", [
            "modelId": .string(modelId),
            "tier": tier.map { .number(Double($0.rawValue)) } ?? .null,
        ])
    }

    public func setConnectionEnabled(_ id: String, enabled: Bool) async throws -> Bool {
        try await landed("PUT", "api/seam/connections/\(id)/enabled", ["value": .bool(enabled)])
    }

    public func disabledModels(_ id: String) async throws -> [String] {
        try await get([String].self, "api/seam/connections/\(id)/disabled-models") ?? []
    }

    public func setModelEnabled(_ id: String, modelId: String, enabled: Bool) async throws -> Bool {
        try await landed("PUT", "api/seam/connections/\(id)/models/enabled", ["modelId": .string(modelId), "enabled": .bool(enabled)])
    }

    /// The hand-written model catalog, or nil when the connection lists from its
    /// endpoint. Carries no key material — it is the JSON the user typed.
    public func modelCatalog(_ id: String) async throws -> String? {
        try await get(TextResult.self, "api/seam/connections/\(id)/model-catalog")?.value
    }

    /// Replace (nil/empty clears) a catalog; a string answer is the problem with the JSON.
    public func setModelCatalog(_ id: String, json: String?) async throws -> String? {
        try await textResult(
            "PUT", "api/seam/connections/\(id)/model-catalog",
            ["value": json.map(JSONValue.string) ?? .null] as JSONValue, gone: "That connection is gone."
        )
    }

    public func gitConnections() async throws -> [GitConnectionSummary] {
        try await get([GitConnectionSummary].self, "api/seam/git/connections") ?? []
    }

    public func deleteGitConnection(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/git/connections/\(id)")
    }

    public func gitApps() async throws -> [GitAppSummary] {
        try await get([GitAppSummary].self, "api/seam/git/apps") ?? []
    }

    // -- codex --
    //
    // The device flow runs on the server: it holds the PKCE verifier and the
    // tokens, and creates the connection in the poll that sees the approval.

    public func codexStart() async throws -> CodexDeviceStart {
        try await send(CodexDeviceStart.self, "POST", "api/seam/codex/device", [:] as JSONValue)
            ?? CodexDeviceStart(deviceAuthId: nil, userCode: nil, interval: "00:00:00", verificationUrl: "", error: Seam.unanswered)
    }

    public func codexPoll(deviceAuthId: String, userCode: String) async throws -> CodexPollResult {
        let body: JSONValue = ["deviceAuthId": .string(deviceAuthId), "userCode": .string(userCode)]
        return try await send(CodexPollResult.self, "POST", "api/seam/codex/device/poll", body)
            ?? CodexPollResult(status: .failed, error: Seam.unanswered)
    }

    /// The one inbound road for tokens: a paste of `~/.codex/auth.json`.
    public func codexImport(json: String) async throws -> String? {
        try await textResult("POST", "api/seam/codex/import", ["value": .string(json)] as JSONValue, gone: Seam.unanswered)
    }

    // -- mcp servers --

    public func mcpServers() async throws -> [McpServerSummary] {
        try await get([McpServerSummary].self, "api/seam/mcp/") ?? []
    }

    public func createMcpServer(_ request: McpServerRequest) async throws -> CreateResult {
        try await send(CreateResult.self, "POST", "api/seam/mcp/", request) ?? CreateResult(id: nil, error: Seam.unanswered)
    }

    public func updateMcpServer(_ id: String, _ request: McpServerRequest) async throws -> String? {
        try await textResult("PUT", "api/seam/mcp/\(id)", request, gone: "That server is gone.")
    }

    public func setMcpServerEnabled(_ id: String, enabled: Bool) async throws -> Bool {
        try await landed("PUT", "api/seam/mcp/\(id)/enabled", ["value": .bool(enabled)])
    }

    public func deleteMcpServer(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/mcp/\(id)")
    }

    // -- code reviews --
    //
    // Over `/api/seam/reviews/*` (the web's `HttpCodeReviewsApi`). A 404 is nil
    // here for every route: another owner's review reads the same as one that
    // does not exist, and each screen words it. Reviews are requested by an
    // agent's tools, never from here.

    /// The reviews this session started and those its agent commented on, newest first. Nil: no such session.
    public func sessionReviews(_ sessionId: String) async throws -> [CodeReviewSessionReview]? {
        try await get([CodeReviewSessionReview].self, "api/seam/reviews/sessions/\(sessionId)")
    }

    public func reviewDetail(_ reviewId: String) async throws -> CodeReviewDetail? {
        try await get(CodeReviewDetail.self, "api/seam/reviews/\(reviewId)")
    }

    /// Cancel: terminal; queued and running work is cancelled with it. Nil: not yours or gone.
    public func cancelReview(_ reviewId: String) async throws -> CodeReviewCancelResult? {
        try await request(CodeReviewCancelResult.self, "POST", "api/seam/reviews/\(reviewId)/cancel").value
    }

    public func reviewFindings(_ reviewId: String) async throws -> CodeReviewFindingList? {
        try await get(CodeReviewFindingList.self, "api/seam/reviews/\(reviewId)/findings")
    }

    public func reviewFinding(_ reviewId: String, findingId: String) async throws -> CodeReviewFindingDetail? {
        try await get(CodeReviewFindingDetail.self, "api/seam/reviews/\(reviewId)/findings/\(findingId)")
    }

    /// Accept, dismiss or reopen one finding. A refused update is a 200 whose
    /// `status` says so (a version conflict, a rebuilt consolidation, superseded,
    /// invalid) — never an overwrite; the screen words it and reloads.
    public func setFindingDisposition(
        _ reviewId: String, findingId: String, _ request: CodeReviewFindingDispositionRequest
    ) async throws -> CodeReviewFindingDispositionResult? {
        try await send(
            CodeReviewFindingDispositionResult.self, "POST",
            "api/seam/reviews/\(reviewId)/findings/\(findingId)/disposition", request
        )
    }

    /// The finding's anchored lines with context, from the review's pinned commits.
    public func reviewFindingDiff(_ reviewId: String, findingId: String) async throws -> CodeReviewFindingDiff? {
        try await get(CodeReviewFindingDiff.self, "api/seam/reviews/\(reviewId)/findings/\(findingId)/diff")
    }

    // -- code review publications --
    //
    // Whether the review can be published, where each finding would go, and its
    // publications so far; then the confirm-gated publish and retry. The request
    // id is minted when the confirmation opens, so a resend is the same
    // publication, and nothing is ever sent without `confirmed: true`.

    public func reviewPublications(_ reviewId: String) async throws -> CodeReviewPublicationOverview? {
        try await get(CodeReviewPublicationOverview.self, "api/seam/reviews/\(reviewId)/publications")
    }

    /// Exactly what publishing these findings would post; nothing is sent.
    public func previewReviewPublication(
        _ reviewId: String, findingIds: [String], event: CodeReviewPublicationEvent
    ) async throws -> CodeReviewPublicationPreview? {
        try await send(
            CodeReviewPublicationPreview.self, "POST", "api/seam/reviews/\(reviewId)/publications/preview",
            CodeReviewPublicationPreviewRequest(findingIds: findingIds, event: event)
        )
    }

    public func publishReview(
        requestId: String, _ reviewId: String, _ request: CodeReviewPublishRequest
    ) async throws -> CodeReviewPublishResult? {
        var request = request
        request.requestId = requestId
        request.confirmed = true
        return try await send(CodeReviewPublishResult.self, "POST", "api/seam/reviews/\(reviewId)/publications", request)
    }

    public func retryReviewPublication(_ reviewId: String, publicationId: String) async throws -> CodeReviewPublishResult? {
        try await send(
            CodeReviewPublishResult.self, "POST",
            "api/seam/reviews/\(reviewId)/publications/\(publicationId)/retry",
            CodeReviewPublicationRetryRequest(confirmed: true)
        )
    }

    // -- remote nodes --

    public func createNode(_ request: RemoteNodeRequest) async throws -> NodeCreateResult {
        try await send(NodeCreateResult.self, "POST", "api/seam/nodes/", request)
            ?? NodeCreateResult(id: nil, error: Seam.unanswered, authorizedKeysLine: nil)
    }

    public func updateNode(_ id: String, _ request: RemoteNodeRequest) async throws -> String? {
        try await textResult("PUT", "api/seam/nodes/\(id)", request, gone: "That node is gone.")
    }

    public func regenerateNodeKey(_ id: String) async throws -> NodeKeyResult {
        let (status, value) = try await request(NodeKeyResult.self, "POST", "api/seam/nodes/\(id)/key", body: Seam.emptyBody)
        if status == 404 { return NodeKeyResult(authorizedKeysLine: nil, error: "That node is gone.") }
        return value ?? NodeKeyResult(authorizedKeysLine: nil, error: Seam.unanswered)
    }

    public func setNodeEnabled(_ id: String, enabled: Bool) async throws -> Bool {
        try await landed("PUT", "api/seam/nodes/\(id)/enabled", ["value": .bool(enabled)])
    }

    public func deleteNode(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/nodes/\(id)")
    }

    public func resetNodeHostKeyPin(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/nodes/\(id)/host-key-pin")
    }

    public func testNode(_ id: String) async throws -> NodeTestResult {
        let (status, value) = try await request(NodeTestResult.self, "POST", "api/seam/nodes/\(id)/test", body: Seam.emptyBody)
        if status == 404 { return NodeTestResult(ok: false, detail: "That node is gone.") }
        return value ?? NodeTestResult(ok: false, detail: Seam.unanswered)
    }

    // -- terminal --

    public func terminalDefaults() async throws -> TerminalDefaults? {
        try await get(TerminalDefaults.self, "api/seam/terminal-settings/defaults")
    }

    public func terminalPrefs() async throws -> TerminalPrefs {
        try await get(TerminalPrefs.self, "api/seam/terminal-settings/") ?? TerminalPrefs()
    }

    public func saveTerminalPrefs(packages: String?, shell: String?) async throws {
        try await sendVoid("PUT", "api/seam/terminal-settings/", [
            "packages": packages.map(JSONValue.string) ?? .null,
            "shell": shell.map(JSONValue.string) ?? .null,
        ] as JSONValue)
    }

    // -- git identity --

    public func gitIdentity() async throws -> GitIdentityPrefs {
        try await get(GitIdentityPrefs.self, "api/seam/git-identity/") ?? GitIdentityPrefs()
    }

    /// Blank fields clear. The server answers a bad value with a 400; check with `gitIdentityProblem` first.
    public func saveGitIdentity(name: String?, email: String?) async throws {
        try await sendVoid("PUT", "api/seam/git-identity/", [
            "name": name.map(JSONValue.string) ?? .null,
            "email": email.map(JSONValue.string) ?? .null,
        ] as JSONValue)
    }

    // -- facets, hooks, permission rules --

    public func userFacets() async throws -> [UserFacetSummary] {
        try await get([UserFacetSummary].self, "api/seam/user-config/facets") ?? []
    }

    public func saveFacet(name: String, content: String) async throws {
        try await sendVoid("POST", "api/seam/user-config/facets", ["name": .string(name), "content": .string(content)] as JSONValue)
    }

    public func deleteFacet(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/user-config/facets/\(id)")
    }

    /// The exact parser the runtime uses, so a facet that checks out here loads there.
    public func checkFacet(name: String, content: String) async throws -> FacetCheck {
        let body: JSONValue = ["name": .string(name), "content": .string(content)]
        return try await send(FacetCheck.self, "POST", "api/seam/user-config/facets/check", body)
            ?? FacetCheck(name: nil, toolsAllowed: 0, toolsDenied: 0, model: nil, error: "the server did not answer")
    }

    public func hooks() async throws -> String? {
        try await get(TextResult.self, "api/seam/user-config/hooks")?.value
    }

    /// An empty document removes the global hooks.
    public func saveHooks(json: String?) async throws {
        try await sendVoid("PUT", "api/seam/user-config/hooks", ["value": json.map(JSONValue.string) ?? .null] as JSONValue)
    }

    public func permissions() async throws -> String? {
        try await get(TextResult.self, "api/seam/user-config/permissions")?.value
    }

    public func savePermissions(yaml: String?) async throws {
        try await sendVoid("PUT", "api/seam/user-config/permissions", ["value": yaml.map(JSONValue.string) ?? .null] as JSONValue)
    }

    public func checkPermissions(yaml: String) async throws -> PermissionsCheck {
        try await send(PermissionsCheck.self, "POST", "api/seam/user-config/permissions/check", ["value": .string(yaml)] as JSONValue)
            ?? PermissionsCheck(ruleCount: 0, error: Seam.unanswered)
    }

    // -- artifacts --

    public func artifacts() async throws -> [ArtifactSummary] {
        try await get([ArtifactSummary].self, "api/seam/artifacts/") ?? []
    }

    /// Nil when the artifact is gone, or was never this account's.
    public func artifact(_ id: String) async throws -> ArtifactDetail? {
        try await get(ArtifactDetail.self, "api/seam/artifacts/\(id)")
    }

    /// One kept edition; nil when it is no longer kept (or never existed).
    public func artifactVersion(_ id: String, version: Int) async throws -> ArtifactVersionDetail? {
        try await get(ArtifactVersionDetail.self, "api/seam/artifacts/\(id)/versions/\(version)")
    }

    /// Mints or revokes the unlisted link; the summary comes back with the new token.
    public func shareArtifact(_ id: String, shared: Bool) async throws -> ArtifactSummary? {
        try await send(ArtifactSummary.self, "POST", "api/seam/artifacts/\(id)/share", ["shared": .bool(shared)] as JSONValue)
    }

    /// Reads the mini app's status, or — given `running` — starts or stops it.
    public func artifactApp(_ id: String, running: Bool? = nil) async throws -> ArtifactAppStatus? {
        guard let running else { return try await get(ArtifactAppStatus.self, "api/seam/artifacts/\(id)/app") }
        return try await send(ArtifactAppStatus.self, "POST", "api/seam/artifacts/\(id)/app", ["running": .bool(running)] as JSONValue)
    }

    public func deleteArtifact(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/artifacts/\(id)")
    }

    /// Where an artifact's bytes live. Two URLs, and the difference matters: the
    /// owner's needs the bearer key, so it is only useful to fetch from inside
    /// the app, while the share link opens in any browser and is the one to hand
    /// to the system share sheet.
    public func artifactRawUrl(_ id: String) -> String { "\(baseUrl)/artifacts/\(id)/raw" }

    /// A picture a tool returned, kept with its session's transcript; owner-only.
    public func toolImageUrl(_ id: String) -> String { "\(baseUrl)/tool-images/\(encodeURIComponent(id))" }

    /// The picture a 3D scene tool handed the agent; owner-only.
    public func sceneRenderUrl(_ id: String) -> String { "\(baseUrl)/scenes/renders/\(encodeURIComponent(id)).png" }

    /// One edition's bytes; owner-only, like the latest's.
    public func artifactVersionRawUrl(_ id: String, version: Int) -> String { "\(baseUrl)/artifacts/\(id)/versions/\(version)/raw" }

    /// One edition's page, under the same sandbox CSP as the latest's.
    public func artifactVersionViewUrl(_ id: String, version: Int) -> String { "\(baseUrl)/artifacts/\(id)/versions/\(version)/view" }

    /// The owner-authenticated HTML page, including its opaque-origin sandbox CSP.
    public func artifactViewUrl(_ id: String) -> String { "\(baseUrl)/artifacts/\(id)/view" }

    public func shareUrl(_ sharePath: String) -> String { "\(baseUrl)/\(sharePath)" }

    /// Owner-only bytes from outside the seam group: an artifact, a tool image.
    /// Nil on a 404.
    public func fetchBytes(_ url: String) async throws -> Data? {
        let response: HTTPResponse
        do {
            response = try await transport.send(HTTPRequest(method: "GET", url: url, headers: authHeaders))
        } catch {
            if isCancellation(error) { throw CancellationError() }
            throw OfflineError()
        }
        if response.status == 401 {
            onSignedOut?()
            throw SignedOutError()
        }
        if response.status == 404 { return nil }
        if !response.ok { throw SeamError(status: response.status, message: "GET failed: \(response.status)") }
        return response.body
    }

    // -- memory --

    public func memories() async throws -> [MemorySummary] {
        try await get([MemorySummary].self, "api/seam/memory/") ?? []
    }

    public func saveMemory(_ request: SaveMemoryRequest) async throws {
        try await sendVoid("POST", "api/seam/memory/", request)
    }

    public func deleteMemory(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/memory/\(id)")
    }

    // -- skills --

    public func skills() async throws -> [UserSkillSummary] {
        try await get([UserSkillSummary].self, "api/seam/skills/") ?? []
    }

    /// A save that the parser refuses answers with why; nil is saved.
    public func saveSkill(name: String, content: String) async throws -> String? {
        try await textResult("POST", "api/seam/skills/", ["name": .string(name), "content": .string(content)] as JSONValue, gone: Seam.unanswered)
    }

    public func deleteSkill(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/skills/\(id)")
    }

    // -- channels --

    public func createChannel(_ draft: ChannelDraft) async throws -> String? {
        try await textResult("POST", "api/seam/channels/", draft, gone: Seam.unanswered)
    }

    public func updateChannel(_ id: String, _ draft: ChannelDraft) async throws -> String? {
        try await textResult("PUT", "api/seam/channels/\(id)", draft, gone: "That channel is gone.")
    }

    public func deleteChannel(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/channels/\(id)")
    }

    public func setChannelEnabled(_ id: String, enabled: Bool) async throws -> String? {
        try await textResult("POST", "api/seam/channels/\(id)/enabled/\(enabled)", [:] as JSONValue, gone: "That channel is gone.")
    }

    /// The code the bot (or the mailbox) handed a stranger. In the body: a URL ends up in logs.
    public func pairChannel(_ id: String, code: String) async throws -> String? {
        try await textResult("POST", "api/seam/channels/\(id)/pair", ["code": .string(code)] as JSONValue, gone: "That channel is gone.")
    }

    public func unpairChannel(_ id: String, peerId: String) async throws -> String? {
        try await textResult("POST", "api/seam/channels/\(id)/unpair", ["peerId": .string(peerId)] as JSONValue, gone: "That channel is gone.")
    }

    public func testChannel(_ id: String) async throws -> String? {
        try await textResult("POST", "api/seam/channels/\(id)/test", [:] as JSONValue, gone: "That channel is gone.")
    }

    // -- api keys --

    public func apiKeys() async throws -> [ApiKeySummary] {
        try await get([ApiKeySummary].self, "api/seam/api-keys/") ?? []
    }

    /// The full key is in this answer and nowhere else, ever again.
    public func mintApiKey(name: String) async throws -> MintedApiKey? {
        try await send(MintedApiKey.self, "POST", "api/seam/api-keys/", ["name": .string(name)] as JSONValue)
    }

    public func revokeApiKey(_ id: String) async throws -> Bool {
        try await landed("DELETE", "api/seam/api-keys/\(id)")
    }

    // -- push --
    //
    // The phone subscribes the way a browser would: the endpoint the relay gave
    // it, and the keys it made. The instance never learns a phone is involved.

    public func subscribePush(endpoint: String, p256dh: String, auth: String) async throws {
        try await sendVoid("POST", "api/seam/push/subscribe", [
            "endpoint": .string(endpoint), "p256dh": .string(p256dh), "auth": .string(auth),
        ] as JSONValue)
    }

    public func unsubscribePush(endpoint: String) async throws {
        try await sendVoid("POST", "api/seam/push/unsubscribe", ["endpoint": .string(endpoint)] as JSONValue)
    }

    /// A 90-second single-use code another device redeems for a key of its own.
    public func startPairing() async throws -> DevicePairingCode? {
        try await send(DevicePairingCode.self, "POST", "api/seam/api-keys/pairing", [:] as JSONValue)
    }
}

func trimTrailingSlashes(_ text: String) -> String {
    var result = Substring(text)
    while result.hasSuffix("/") { result = result.dropLast() }
    return String(result)
}

// MARK: - device auth: the only calls made without a key

public enum DeviceAuth {
    private static func claim<B: Encodable>(
        _ baseUrl: String, _ path: String, _ body: B, transport: HTTPTransport
    ) async throws -> DeviceKey {
        let response: HTTPResponse
        do {
            response = try await transport.send(HTTPRequest(
                method: "POST",
                url: "\(trimTrailingSlashes(baseUrl))\(path)",
                headers: ["Content-Type": "application/json"],
                body: try Wire.encode(body)
            ))
        } catch {
            if isCancellation(error) { throw CancellationError() }
            // A typo'd address and a server that is down look identical from here, and
            // both are "could not reach" rather than "wrong password".
            throw OfflineError()
        }

        let payload = JSONValue.parse(response.body) ?? .object([:])
        if !response.ok {
            throw SeamError(status: response.status, message: payload["error"].string ?? "invalid")
        }
        return payload.decoded(DeviceKey.self) ?? DeviceKey()
    }

    public static func loginWithPassword(
        _ baseUrl: String, _ request: PasswordLoginRequest, transport: HTTPTransport = URLSessionTransport()
    ) async throws -> DeviceKey {
        try await claim(baseUrl, "/api/auth/device/password", request, transport: transport)
    }

    public static func redeemPairingCode(
        _ baseUrl: String, _ request: PairRequest, transport: HTTPTransport = URLSessionTransport()
    ) async throws -> DeviceKey {
        try await claim(baseUrl, "/api/auth/device/pair", request, transport: transport)
    }
}

public struct PairingTarget: Equatable, Sendable {
    public let server: String
    public let code: String

    public init(server: String, code: String) {
        self.server = server
        self.code = code
    }
}

/// `slopcoder://pair?server=<url>&code=<CODE>` — what the settings page draws.
public func parsePairingUri(_ raw: String) -> PairingTarget? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let prefix = "slopcoder://pair?"
    guard trimmed.hasPrefix(prefix) else { return nil }
    let params = parseQuery(String(trimmed.dropFirst(prefix.count)))
    guard let server = params["server"], !server.isEmpty, let code = params["code"], !code.isEmpty else { return nil }
    return PairingTarget(server: server, code: code)
}

/// `URLSearchParams`: first value wins, `+` is a space.
public func parseQuery(_ query: String) -> [String: String] {
    var result: [String: String] = [:]
    for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
        let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        let decode: (Substring) -> String = { part in
            let spaced = part.replacingOccurrences(of: "+", with: " ")
            return spaced.removingPercentEncoding ?? spaced
        }
        let key = decode(parts[0])
        let value = parts.count > 1 ? decode(parts[1]) : ""
        if result[key] == nil { result[key] = value }
    }
    return result
}
