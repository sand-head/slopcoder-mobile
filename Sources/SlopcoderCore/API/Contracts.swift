// The seam's wire types, hand-ported from `src/SlopCoder.Contracts/`.
//
// slopcoder exposes no OpenAPI document, so these are written rather than
// generated. Two things about the encoding are easy to get wrong and expensive
// to debug:
//
// 1. **Enums travel as integers.** The server serializes with
//    `JsonSerializerDefaults.Web`, which adds no string-enum converter. Every
//    enum below is numeric, and the numbers are the contract — `ApprovalMode`
//    in particular reserves 3 for a retired member and must never be renumbered.
//    They are structs over a raw `Int`, not Swift enums, so a member a newer
//    server adds survives a round trip instead of failing the whole decode.
// 2. **Property names are camelCase**, because `JsonSerializerDefaults.Web`
//    does apply that.
//
// Decoding is lenient on purpose: a field an older server does not send takes
// its zero value rather than throwing, because a phone is routinely newer than
// the server it talks to.

import Foundation

// ---- enums (integers on the wire) ----

/// The seam's wire types, hand-ported from `src/SlopCoder.Contracts/`.
///
/// slopcoder exposes no OpenAPI document, so these are written rather than
/// generated. Two things about the encoding are easy to get wrong and expensive
/// to debug:
///
/// 1. **Enums travel as integers.** The server serializes with
///    `JsonSerializerDefaults.Web`, which adds no string-enum converter. Every
///    enum below is numeric, and the numbers are the contract — `ApprovalMode`
///    in particular reserves 3 for a retired member and must never be renumbered.
/// 2. **Property names are camelCase**, because `JsonSerializerDefaults.Web`
///    does apply that.
///
/// `scripts/wire-check.cjs` pins both against a live server.
public struct SessionStatus: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let idle = SessionStatus(rawValue: 0)
    public static let running = SessionStatus(rawValue: 1)

    public static let allKnown: [SessionStatus] = [.idle, .running]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Idle"
        case 1: return "Running"
        default: return nil
        }
    }
}

/// The outcome of deleting a session. Mirrors `DeleteResult` on the server.
public struct DeleteResult: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let deleted = DeleteResult(rawValue: 0)
    public static let notFound = DeleteResult(rawValue: 1)
    /// A turn is in flight; stop it first.
    public static let running = DeleteResult(rawValue: 2)

    public static let allKnown: [DeleteResult] = [.deleted, .notFound, .running]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Deleted"
        case 1: return "NotFound"
        case 2: return "Running"
        default: return nil
        }
    }
}

public struct ApprovalMode: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    /// Ask only for what the classifier escalates. The default.
    public static let dangerous = ApprovalMode(rawValue: 0)
    /// Never ask.
    public static let auto = ApprovalMode(rawValue: 1)
    /// Ask on every tool call.
    public static let always = ApprovalMode(rawValue: 2)

    public static let allKnown: [ApprovalMode] = [.dangerous, .auto, .always]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Dangerous"
        case 1: return "Auto"
        case 2: return "Always"
        default: return nil
        }
    }
}

public struct ThinkingLevel: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let off = ThinkingLevel(rawValue: 0)
    public static let low = ThinkingLevel(rawValue: 1)
    public static let medium = ThinkingLevel(rawValue: 2)
    public static let high = ThinkingLevel(rawValue: 3)
    public static let max = ThinkingLevel(rawValue: 4)

    public static let allKnown: [ThinkingLevel] = [.off, .low, .medium, .high, .max]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Off"
        case 1: return "Low"
        case 2: return "Medium"
        case 3: return "High"
        case 4: return "Max"
        default: return nil
        }
    }
}

public struct SandboxState: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let host = SandboxState(rawValue: 0)
    public static let running = SandboxState(rawValue: 1)
    public static let stopped = SandboxState(rawValue: 2)

    public static let allKnown: [SandboxState] = [.host, .running, .stopped]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Host"
        case 1: return "Running"
        case 2: return "Stopped"
        default: return nil
        }
    }
}

public struct ProviderFault: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let none = ProviderFault(rawValue: 0)
    public static let transient = ProviderFault(rawValue: 1)
    public static let rateLimited = ProviderFault(rawValue: 2)
    public static let planLimit = ProviderFault(rawValue: 3)
    public static let outOfCredit = ProviderFault(rawValue: 4)
    public static let auth = ProviderFault(rawValue: 5)
    public static let badRequest = ProviderFault(rawValue: 6)
    public static let unknown = ProviderFault(rawValue: 7)
    public static let contextWindow = ProviderFault(rawValue: 8)

    public static let allKnown: [ProviderFault] = [.none, .transient, .rateLimited, .planLimit, .outOfCredit, .auth, .badRequest, .unknown, .contextWindow]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "None"
        case 1: return "Transient"
        case 2: return "RateLimited"
        case 3: return "PlanLimit"
        case 4: return "OutOfCredit"
        case 5: return "Auth"
        case 6: return "BadRequest"
        case 7: return "Unknown"
        case 8: return "ContextWindow"
        default: return nil
        }
    }
}

public struct GitServiceKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let gitHub = GitServiceKind(rawValue: 0)
    public static let forgejo = GitServiceKind(rawValue: 1)

    public static let allKnown: [GitServiceKind] = [.gitHub, .forgejo]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "GitHub"
        case 1: return "Forgejo"
        default: return nil
        }
    }
}

// ---- sessions ----

/// Which machine a session's workspace lives on; absent means the server sandbox.
public struct ClientWorkspace: Codable, Hashable, Sendable {
    public var machineId: String
    public var machineName: String
    public var directory: String

    public init(
        machineId: String = "",
        machineName: String = "",
        directory: String = ""
    ) {
        self.machineId = machineId
        self.machineName = machineName
        self.directory = directory
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        machineId = c.lenient(.machineId) ?? ""
        machineName = c.lenient(.machineName) ?? ""
        directory = c.lenient(.directory) ?? ""
    }
}

public struct SessionSummary: Codable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var model: String
    public var autoRoute: Bool
    public var status: SessionStatus
    public var createdAt: String
    public var updatedAt: String
    /// Null for a server-sandboxed session — which is every one this app creates.
    public var clientWorkspace: ClientWorkspace?
    /// Null when there is no machine to be connected. False means it is offline.
    public var workspaceConnected: Bool?
    /// Bounded repository display labels; absent on older servers.
    public var repoNames: [String]?

    public init(
        id: String = "",
        title: String = "",
        model: String = "",
        autoRoute: Bool = false,
        status: SessionStatus = SessionStatus(rawValue: 0),
        createdAt: String = "",
        updatedAt: String = "",
        clientWorkspace: ClientWorkspace? = nil,
        workspaceConnected: Bool? = nil,
        repoNames: [String]? = nil
    ) {
        self.id = id
        self.title = title
        self.model = model
        self.autoRoute = autoRoute
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.clientWorkspace = clientWorkspace
        self.workspaceConnected = workspaceConnected
        self.repoNames = repoNames
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        title = c.lenient(.title) ?? ""
        model = c.lenient(.model) ?? ""
        autoRoute = c.lenient(.autoRoute) ?? false
        status = c.lenient(.status) ?? SessionStatus(rawValue: 0)
        createdAt = c.lenient(.createdAt) ?? ""
        updatedAt = c.lenient(.updatedAt) ?? ""
        clientWorkspace = c.lenient(.clientWorkspace)
        workspaceConnected = c.lenient(.workspaceConnected)
        repoNames = c.lenient(.repoNames)
    }
}

/// `"auto"`, or a specific model on a specific connection.
public struct ModelSelection: Codable, Hashable, Sendable {
    public var auto: Bool
    public var connectionId: String?
    public var modelId: String?

    public init(
        auto: Bool = false,
        connectionId: String? = nil,
        modelId: String? = nil
    ) {
        self.auto = auto
        self.connectionId = connectionId
        self.modelId = modelId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        auto = c.lenient(.auto) ?? false
        connectionId = c.lenient(.connectionId)
        modelId = c.lenient(.modelId)
    }
}

extension ModelSelection {
    /// `"auto"`: let the server route.
    public static let autoRoute = ModelSelection(auto: true, connectionId: nil, modelId: nil)
}

public struct FacetOption: Codable, Hashable, Sendable {
    public var name: String
    public var description: String?

    public init(
        name: String = "",
        description: String? = nil
    ) {
        self.name = name
        self.description = description
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lenient(.name) ?? ""
        description = c.lenient(.description)
    }
}

public struct LiveSnapshot: Codable, Hashable, Sendable {
    public var thinking: String
    public var text: String

    public init(
        thinking: String = "",
        text: String = ""
    ) {
        self.thinking = thinking
        self.text = text
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        thinking = c.lenient(.thinking) ?? ""
        text = c.lenient(.text) ?? ""
    }
}

public struct UsageReport: Codable, Hashable, Sendable {
    public var inputTokens: Int
    public var outputTokens: Int
    public var cacheReadInputTokens: Int
    public var cacheCreationInputTokens: Int
    public var model: String
    public var contextWindowTokens: Int
    public var connectionId: String?
    public var providerKind: Int?
    public var connectionDisplayName: String?

    public init(
        inputTokens: Int = 0,
        outputTokens: Int = 0,
        cacheReadInputTokens: Int = 0,
        cacheCreationInputTokens: Int = 0,
        model: String = "",
        contextWindowTokens: Int = 0,
        connectionId: String? = nil,
        providerKind: Int? = nil,
        connectionDisplayName: String? = nil
    ) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.cacheReadInputTokens = cacheReadInputTokens
        self.cacheCreationInputTokens = cacheCreationInputTokens
        self.model = model
        self.contextWindowTokens = contextWindowTokens
        self.connectionId = connectionId
        self.providerKind = providerKind
        self.connectionDisplayName = connectionDisplayName
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        inputTokens = c.lenient(.inputTokens) ?? 0
        outputTokens = c.lenient(.outputTokens) ?? 0
        cacheReadInputTokens = c.lenient(.cacheReadInputTokens) ?? 0
        cacheCreationInputTokens = c.lenient(.cacheCreationInputTokens) ?? 0
        model = c.lenient(.model) ?? ""
        contextWindowTokens = c.lenient(.contextWindowTokens) ?? 0
        connectionId = c.lenient(.connectionId)
        providerKind = c.lenient(.providerKind)
        connectionDisplayName = c.lenient(.connectionDisplayName)
    }
}

public struct ModelUsage: Codable, Hashable, Sendable {
    public var model: String
    public var inputTokens: Int
    public var outputTokens: Int
    public var cacheReadTokens: Int
    public var cacheWriteTokens: Int
    public var completions: Int

    public init(
        model: String = "",
        inputTokens: Int = 0,
        outputTokens: Int = 0,
        cacheReadTokens: Int = 0,
        cacheWriteTokens: Int = 0,
        completions: Int = 0
    ) {
        self.model = model
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.cacheReadTokens = cacheReadTokens
        self.cacheWriteTokens = cacheWriteTokens
        self.completions = completions
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        model = c.lenient(.model) ?? ""
        inputTokens = c.lenient(.inputTokens) ?? 0
        outputTokens = c.lenient(.outputTokens) ?? 0
        cacheReadTokens = c.lenient(.cacheReadTokens) ?? 0
        cacheWriteTokens = c.lenient(.cacheWriteTokens) ?? 0
        completions = c.lenient(.completions) ?? 0
    }
}

public struct UsageSummary: Codable, Hashable, Sendable {
    public var models: [ModelUsage]
    public var estimatedCost: Double?

    public init(
        models: [ModelUsage] = [],
        estimatedCost: Double? = nil
    ) {
        self.models = models
        self.estimatedCost = estimatedCost
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        models = c.lenient(.models) ?? []
        estimatedCost = c.lenient(.estimatedCost)
    }
}

public struct LimitWindow: Codable, Hashable, Sendable {
    public var label: String
    public var usedPercent: Double?
    public var resetsAt: String?

    public init(
        label: String = "",
        usedPercent: Double? = nil,
        resetsAt: String? = nil
    ) {
        self.label = label
        self.usedPercent = usedPercent
        self.resetsAt = resetsAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = c.lenient(.label) ?? ""
        usedPercent = c.lenient(.usedPercent)
        resetsAt = c.lenient(.resetsAt)
    }
}

public struct ProviderQuota: Codable, Hashable, Sendable {
    public var windows: [LimitWindow]
    public var fault: ProviderFault
    public var faultMessage: String?
    public var faultClearsAt: String?
    public var observedAt: String
    public var planType: String?
    public var pollError: String?

    public init(
        windows: [LimitWindow] = [],
        fault: ProviderFault = ProviderFault(rawValue: 0),
        faultMessage: String? = nil,
        faultClearsAt: String? = nil,
        observedAt: String = "",
        planType: String? = nil,
        pollError: String? = nil
    ) {
        self.windows = windows
        self.fault = fault
        self.faultMessage = faultMessage
        self.faultClearsAt = faultClearsAt
        self.observedAt = observedAt
        self.planType = planType
        self.pollError = pollError
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        windows = c.lenient(.windows) ?? []
        fault = c.lenient(.fault) ?? ProviderFault(rawValue: 0)
        faultMessage = c.lenient(.faultMessage)
        faultClearsAt = c.lenient(.faultClearsAt)
        observedAt = c.lenient(.observedAt) ?? ""
        planType = c.lenient(.planType)
        pollError = c.lenient(.pollError)
    }
}

public struct AttachedNode: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var host: String
    public var port: Int
    public var username: String

    public init(
        id: String = "",
        name: String = "",
        host: String = "",
        port: Int = 0,
        username: String = ""
    ) {
        self.id = id
        self.name = name
        self.host = host
        self.port = port
        self.username = username
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        name = c.lenient(.name) ?? ""
        host = c.lenient(.host) ?? ""
        port = c.lenient(.port) ?? 0
        username = c.lenient(.username) ?? ""
    }
}

/// A sub-session this session's agent has opened: a whole session of its own,
/// driven by the agent instead of the user. The parent lists it; its
/// transcript is read from the sub-session itself.
public struct SubSessionInfo: Codable, Hashable, Sendable {
    public var id: String
    /// What it was brought on to cover ("push relay"), not what it is called.
    public var name: String
    public var model: String
    public var profile: String
    public var status: SessionStatus
    /// Prompts the driving agent has sent so far.
    public var turns: Int
    /// The driving agent set it aside. Not an ending: prompting it again revives
    /// it with everything it knows.
    public var closed: Bool
    public var openedAt: String
    /// The name it goes by ("Ada") — how the driving agent addresses it and what
    /// this app calls it. Absent on sub-sessions made before personas, where the
    /// name is still the handle.
    public var persona: String?
    /// Prompts waiting in its mailbox behind the one it is working on.
    public var queued: Int?
    /// Tokens it has cost so far (uncached input + cache writes + output).
    public var newTokens: Int?
    /// The dollar estimate for those tokens, when its model has a known price.
    public var cost: Double?
    /// Its accent (`tintFor`), so one partner is the same shade everywhere. Absent
    /// renders untinted.
    public var color: String?

    public init(
        id: String = "",
        name: String = "",
        model: String = "",
        profile: String = "",
        status: SessionStatus = SessionStatus(rawValue: 0),
        turns: Int = 0,
        closed: Bool = false,
        openedAt: String = "",
        persona: String? = nil,
        queued: Int? = nil,
        newTokens: Int? = nil,
        cost: Double? = nil,
        color: String? = nil
    ) {
        self.id = id
        self.name = name
        self.model = model
        self.profile = profile
        self.status = status
        self.turns = turns
        self.closed = closed
        self.openedAt = openedAt
        self.persona = persona
        self.queued = queued
        self.newTokens = newTokens
        self.cost = cost
        self.color = color
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        name = c.lenient(.name) ?? ""
        model = c.lenient(.model) ?? ""
        profile = c.lenient(.profile) ?? ""
        status = c.lenient(.status) ?? SessionStatus(rawValue: 0)
        turns = c.lenient(.turns) ?? 0
        closed = c.lenient(.closed) ?? false
        openedAt = c.lenient(.openedAt) ?? ""
        persona = c.lenient(.persona)
        queued = c.lenient(.queued)
        newTokens = c.lenient(.newTokens)
        cost = c.lenient(.cost)
        color = c.lenient(.color)
    }
}

/// The cockpit's chrome. Deliberately small — it is pushed on every change at
/// ~75ms coalescing, and scrollback never rides it.
public struct SessionState: Codable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var status: SessionStatus
    public var stopRequested: Bool
    public var connectionId: String?
    public var selectedModel: String?
    public var autoRoute: Bool
    public var thinkingLevel: ThinkingLevel?
    public var approvalMode: ApprovalMode
    public var useClassifier: Bool
    public var facetName: String?
    public var goalText: String?
    public var repoNames: [String]
    public var skillNames: [String]
    public var checkpointCount: Int
    /// Scrollback length; the ordinal the next event will take.
    public var nextOrdinal: Int
    /// Null between turns. Nulled out of every Delta push — patches carry it instead.
    public var live: LiveSnapshot?
    public var facetCatalog: [FacetOption]
    /// The only trustworthy source of approval liveness. Never read it off the transcript.
    public var pendingApprovalIds: [String]
    public var pendingQuestionIds: [String]
    public var lastUsage: UsageReport?
    public var usage: UsageSummary
    public var quota: ProviderQuota?
    public var sandboxState: SandboxState
    public var lastActivityAt: String
    public var attachedNodes: [AttachedNode]
    public var subSessions: [SubSessionInfo]
    public var backgroundJobCount: Int
    public var effectiveThinkingLevel: ThinkingLevel?
    public var clientWorkspace: ClientWorkspace?
    /// Set on a sub-session: the session whose agent drives it. No composer there.
    public var parentSessionId: String?
    public var subSessionProfile: String?
    /// A sub-session its driving agent has set aside. Reversible: a prompt revives it.
    public var closed: Bool?
    /// Agent handle, used by direct session messaging; null on older sessions.
    public var chatHandle: String?
    /// When it was archived for going untouched too long, or null. An archived
    /// session is read-only for good: its transcript stays, nothing runs again.
    public var archivedAt: String?

    public init(
        id: String = "",
        title: String = "",
        status: SessionStatus = SessionStatus(rawValue: 0),
        stopRequested: Bool = false,
        connectionId: String? = nil,
        selectedModel: String? = nil,
        autoRoute: Bool = false,
        thinkingLevel: ThinkingLevel? = nil,
        approvalMode: ApprovalMode = ApprovalMode(rawValue: 0),
        useClassifier: Bool = false,
        facetName: String? = nil,
        goalText: String? = nil,
        repoNames: [String] = [],
        skillNames: [String] = [],
        checkpointCount: Int = 0,
        nextOrdinal: Int = 0,
        live: LiveSnapshot? = nil,
        facetCatalog: [FacetOption] = [],
        pendingApprovalIds: [String] = [],
        pendingQuestionIds: [String] = [],
        lastUsage: UsageReport? = nil,
        usage: UsageSummary = UsageSummary(),
        quota: ProviderQuota? = nil,
        sandboxState: SandboxState = SandboxState(rawValue: 0),
        lastActivityAt: String = "",
        attachedNodes: [AttachedNode] = [],
        subSessions: [SubSessionInfo] = [],
        backgroundJobCount: Int = 0,
        effectiveThinkingLevel: ThinkingLevel? = nil,
        clientWorkspace: ClientWorkspace? = nil,
        parentSessionId: String? = nil,
        subSessionProfile: String? = nil,
        closed: Bool? = nil,
        chatHandle: String? = nil,
        archivedAt: String? = nil
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.stopRequested = stopRequested
        self.connectionId = connectionId
        self.selectedModel = selectedModel
        self.autoRoute = autoRoute
        self.thinkingLevel = thinkingLevel
        self.approvalMode = approvalMode
        self.useClassifier = useClassifier
        self.facetName = facetName
        self.goalText = goalText
        self.repoNames = repoNames
        self.skillNames = skillNames
        self.checkpointCount = checkpointCount
        self.nextOrdinal = nextOrdinal
        self.live = live
        self.facetCatalog = facetCatalog
        self.pendingApprovalIds = pendingApprovalIds
        self.pendingQuestionIds = pendingQuestionIds
        self.lastUsage = lastUsage
        self.usage = usage
        self.quota = quota
        self.sandboxState = sandboxState
        self.lastActivityAt = lastActivityAt
        self.attachedNodes = attachedNodes
        self.subSessions = subSessions
        self.backgroundJobCount = backgroundJobCount
        self.effectiveThinkingLevel = effectiveThinkingLevel
        self.clientWorkspace = clientWorkspace
        self.parentSessionId = parentSessionId
        self.subSessionProfile = subSessionProfile
        self.closed = closed
        self.chatHandle = chatHandle
        self.archivedAt = archivedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        title = c.lenient(.title) ?? ""
        status = c.lenient(.status) ?? SessionStatus(rawValue: 0)
        stopRequested = c.lenient(.stopRequested) ?? false
        connectionId = c.lenient(.connectionId)
        selectedModel = c.lenient(.selectedModel)
        autoRoute = c.lenient(.autoRoute) ?? false
        thinkingLevel = c.lenient(.thinkingLevel)
        approvalMode = c.lenient(.approvalMode) ?? ApprovalMode(rawValue: 0)
        useClassifier = c.lenient(.useClassifier) ?? false
        facetName = c.lenient(.facetName)
        goalText = c.lenient(.goalText)
        repoNames = c.lenient(.repoNames) ?? []
        skillNames = c.lenient(.skillNames) ?? []
        checkpointCount = c.lenient(.checkpointCount) ?? 0
        nextOrdinal = c.lenient(.nextOrdinal) ?? 0
        live = c.lenient(.live)
        facetCatalog = c.lenient(.facetCatalog) ?? []
        pendingApprovalIds = c.lenient(.pendingApprovalIds) ?? []
        pendingQuestionIds = c.lenient(.pendingQuestionIds) ?? []
        lastUsage = c.lenient(.lastUsage)
        usage = c.lenient(.usage) ?? UsageSummary()
        quota = c.lenient(.quota)
        sandboxState = c.lenient(.sandboxState) ?? SandboxState(rawValue: 0)
        lastActivityAt = c.lenient(.lastActivityAt) ?? ""
        attachedNodes = c.lenient(.attachedNodes) ?? []
        subSessions = c.lenient(.subSessions) ?? []
        backgroundJobCount = c.lenient(.backgroundJobCount) ?? 0
        effectiveThinkingLevel = c.lenient(.effectiveThinkingLevel)
        clientWorkspace = c.lenient(.clientWorkspace)
        parentSessionId = c.lenient(.parentSessionId)
        subSessionProfile = c.lenient(.subSessionProfile)
        closed = c.lenient(.closed)
        chatHandle = c.lenient(.chatHandle)
        archivedAt = c.lenient(.archivedAt)
    }
}

/// Growth since the previous push, not a snapshot — a full snapshot per 75ms
/// tick would be O(n²) bytes over a long turn. See LiveAccumulator.
public struct LivePatch: Codable, Hashable, Sendable {
    public var thinkingFrom: Int
    public var thinkingAppend: String
    public var textFrom: Int
    public var textAppend: String

    public init(
        thinkingFrom: Int = 0,
        thinkingAppend: String = "",
        textFrom: Int = 0,
        textAppend: String = ""
    ) {
        self.thinkingFrom = thinkingFrom
        self.thinkingAppend = thinkingAppend
        self.textFrom = textFrom
        self.textAppend = textAppend
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        thinkingFrom = c.lenient(.thinkingFrom) ?? 0
        thinkingAppend = c.lenient(.thinkingAppend) ?? ""
        textFrom = c.lenient(.textFrom) ?? 0
        textAppend = c.lenient(.textAppend) ?? ""
    }
}

/// One transcript event. `payloadJson` is a JSON *string* holding the event —
/// parse it a second time. `kind` is the bare C# type name.
public struct AgentEventEnvelope: Codable, Hashable, Sendable {
    public var ordinal: Int
    public var kind: String
    public var payloadJson: String

    public init(
        ordinal: Int = 0,
        kind: String = "",
        payloadJson: String = ""
    ) {
        self.ordinal = ordinal
        self.kind = kind
        self.payloadJson = payloadJson
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ordinal = c.lenient(.ordinal) ?? 0
        kind = c.lenient(.kind) ?? ""
        payloadJson = c.lenient(.payloadJson) ?? ""
    }
}

/// Direct peer message event payload. The sender is always an agent, not the owner.
public struct DirectMessageReceivedPayload: Codable, Hashable, Sendable {
    public var messageId: String
    public var senderSessionId: String?
    public var sender: String
    public var text: String
    public var interjected: Bool?
    public var at: String?

    public init(
        messageId: String = "",
        senderSessionId: String? = nil,
        sender: String = "",
        text: String = "",
        interjected: Bool? = nil,
        at: String? = nil
    ) {
        self.messageId = messageId
        self.senderSessionId = senderSessionId
        self.sender = sender
        self.text = text
        self.interjected = interjected
        self.at = at
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messageId = c.lenient(.messageId) ?? ""
        senderSessionId = c.lenient(.senderSessionId)
        sender = c.lenient(.sender) ?? ""
        text = c.lenient(.text) ?? ""
        interjected = c.lenient(.interjected)
        at = c.lenient(.at)
    }
}

// ---- requests ----

public struct CreateSessionRequest: Codable, Hashable, Sendable {
    public var selection: ModelSelection
    public var initialPrompt: String
    public var repoUrls: [String]?
    public var thinkingLevel: ThinkingLevel?
    public var facet: String?
    public var nodeIds: [String]?
    /// Omitted, always. Leaving this null is the whole mechanism by which a
    /// session runs in the server's Docker sandbox rather than on a laptop — and
    /// a phone has no filesystem to offer as one.
    public var clientWorkspace: JSONValue?

    public init(
        selection: ModelSelection = ModelSelection(),
        initialPrompt: String = "",
        repoUrls: [String]? = nil,
        thinkingLevel: ThinkingLevel? = nil,
        facet: String? = nil,
        nodeIds: [String]? = nil,
        clientWorkspace: JSONValue? = nil
    ) {
        self.selection = selection
        self.initialPrompt = initialPrompt
        self.repoUrls = repoUrls
        self.thinkingLevel = thinkingLevel
        self.facet = facet
        self.nodeIds = nodeIds
        self.clientWorkspace = clientWorkspace
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        selection = c.lenient(.selection) ?? ModelSelection()
        initialPrompt = c.lenient(.initialPrompt) ?? ""
        repoUrls = c.lenient(.repoUrls)
        thinkingLevel = c.lenient(.thinkingLevel)
        facet = c.lenient(.facet)
        nodeIds = c.lenient(.nodeIds)
        clientWorkspace = c.lenient(.clientWorkspace)
    }
}

public struct CreateSessionResult: Codable, Hashable, Sendable {
    public var id: String?

    public init(
        id: String? = nil
    ) {
        self.id = id
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id)
    }
}

public struct ImageAttachment: Codable, Hashable, Sendable {
    public var mediaType: String
    public var base64Data: String

    public init(
        mediaType: String = "",
        base64Data: String = ""
    ) {
        self.mediaType = mediaType
        self.base64Data = base64Data
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mediaType = c.lenient(.mediaType) ?? ""
        base64Data = c.lenient(.base64Data) ?? ""
    }
}

public struct StartSessionRequest: Codable, Hashable, Sendable {
    public var prompt: String
    public var selection: ModelSelection
    public var images: [ImageAttachment]?

    public init(
        prompt: String = "",
        selection: ModelSelection = ModelSelection(),
        images: [ImageAttachment]? = nil
    ) {
        self.prompt = prompt
        self.selection = selection
        self.images = images
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        prompt = c.lenient(.prompt) ?? ""
        selection = c.lenient(.selection) ?? ModelSelection()
        images = c.lenient(.images)
    }
}

public struct SteerRequest: Codable, Hashable, Sendable {
    public var prompt: String

    public init(
        prompt: String = ""
    ) {
        self.prompt = prompt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        prompt = c.lenient(.prompt) ?? ""
    }
}

public struct ResolveApprovalRequest: Codable, Hashable, Sendable {
    public var requestId: String
    public var approved: Bool

    public init(
        requestId: String = "",
        approved: Bool = false
    ) {
        self.requestId = requestId
        self.approved = approved
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requestId = c.lenient(.requestId) ?? ""
        approved = c.lenient(.approved) ?? false
    }
}

public struct UserQuestion: Codable, Hashable, Sendable {
    public var text: String
    public var options: [String]
    public var allowFreeText: Bool

    public init(
        text: String = "",
        options: [String] = [],
        allowFreeText: Bool = false
    ) {
        self.text = text
        self.options = options
        self.allowFreeText = allowFreeText
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.lenient(.text) ?? ""
        options = c.lenient(.options) ?? []
        allowFreeText = c.lenient(.allowFreeText) ?? false
    }
}

public struct UserQuestionAnswer: Codable, Hashable, Sendable {
    public var question: String
    public var answer: String

    public init(
        question: String = "",
        answer: String = ""
    ) {
        self.question = question
        self.answer = answer
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        question = c.lenient(.question) ?? ""
        answer = c.lenient(.answer) ?? ""
    }
}

public struct ResolveQuestionRequest: Codable, Hashable, Sendable {
    public var requestId: String
    /// Null dismisses the question rather than answering it.
    public var answers: [UserQuestionAnswer]?

    public init(
        requestId: String = "",
        answers: [UserQuestionAnswer]? = nil
    ) {
        self.requestId = requestId
        self.answers = answers
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requestId = c.lenient(.requestId) ?? ""
        answers = c.lenient(.answers)
    }
}

public struct RenameRequest: Codable, Hashable, Sendable {
    public var name: String?

    public init(
        name: String? = nil
    ) {
        self.name = name
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lenient(.name)
    }
}

public struct SetThinkingRequest: Codable, Hashable, Sendable {
    public var level: ThinkingLevel?

    public init(
        level: ThinkingLevel? = nil
    ) {
        self.level = level
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        level = c.lenient(.level)
    }
}

public struct SetApprovalRequest: Codable, Hashable, Sendable {
    public var mode: ApprovalMode
    public var useClassifier: Bool

    public init(
        mode: ApprovalMode = ApprovalMode(rawValue: 0),
        useClassifier: Bool = false
    ) {
        self.mode = mode
        self.useClassifier = useClassifier
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = c.lenient(.mode) ?? ApprovalMode(rawValue: 0)
        useClassifier = c.lenient(.useClassifier) ?? false
    }
}

public struct SetFacetRequest: Codable, Hashable, Sendable {
    public var facetName: String?

    public init(
        facetName: String? = nil
    ) {
        self.facetName = facetName
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        facetName = c.lenient(.facetName)
    }
}

// ---- usage ----

public struct UsageRange: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let days7 = UsageRange(rawValue: 0)
    public static let days30 = UsageRange(rawValue: 1)
    public static let days90 = UsageRange(rawValue: 2)
    public static let all = UsageRange(rawValue: 3)

    public static let allKnown: [UsageRange] = [.days7, .days30, .days90, .all]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Days7"
        case 1: return "Days30"
        case 2: return "Days90"
        case 3: return "All"
        default: return nil
        }
    }
}

public struct UsageAttributionQuality: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let exact = UsageAttributionQuality(rawValue: 0)
    public static let inferredLegacy = UsageAttributionQuality(rawValue: 1)
    public static let unknownLegacy = UsageAttributionQuality(rawValue: 2)

    public static let allKnown: [UsageAttributionQuality] = [.exact, .inferredLegacy, .unknownLegacy]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Exact"
        case 1: return "InferredLegacy"
        case 2: return "UnknownLegacy"
        default: return nil
        }
    }
}

public struct UsageTotals: Codable, Hashable, Sendable {
    public var inputTokens: Int
    public var outputTokens: Int
    public var cacheReadTokens: Int
    public var cacheWriteTokens: Int
    public var completions: Int
    public var estimatedCost: Double?
    /// Some model in here has no price, so the cost is a floor, not a total.
    public var hasUnpriced: Bool

    public init(
        inputTokens: Int = 0,
        outputTokens: Int = 0,
        cacheReadTokens: Int = 0,
        cacheWriteTokens: Int = 0,
        completions: Int = 0,
        estimatedCost: Double? = nil,
        hasUnpriced: Bool = false
    ) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.cacheReadTokens = cacheReadTokens
        self.cacheWriteTokens = cacheWriteTokens
        self.completions = completions
        self.estimatedCost = estimatedCost
        self.hasUnpriced = hasUnpriced
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        inputTokens = c.lenient(.inputTokens) ?? 0
        outputTokens = c.lenient(.outputTokens) ?? 0
        cacheReadTokens = c.lenient(.cacheReadTokens) ?? 0
        cacheWriteTokens = c.lenient(.cacheWriteTokens) ?? 0
        completions = c.lenient(.completions) ?? 0
        estimatedCost = c.lenient(.estimatedCost)
        hasUnpriced = c.lenient(.hasUnpriced) ?? false
    }
}

/// Something that counts tokens the four ways the provider bills them.
public protocol TokenCounts {
    var inputTokens: Int { get }
    var outputTokens: Int { get }
    var cacheReadTokens: Int { get }
    var cacheWriteTokens: Int { get }
}

extension UsageTotals: TokenCounts {}
extension ModelUsage: TokenCounts {}

extension TokenCounts {
    /// Tokens actually processed afresh — uncached input, cache writes, output.
    ///
    /// The headline figure, and computed here rather than read off the wire so the
    /// app does not depend on whether the server serializes its computed properties.
    /// In an agent loop the prompt prefix is re-read on every step, so the full
    /// footprint runs to many times this and, shown alone, reads as consumption it
    /// is not.
    public var newTokens: Int { inputTokens + cacheWriteTokens + outputTokens }

    public var totalTokens: Int { inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens }
}

public struct UsageBucket: Codable, Hashable, Sendable {
    /// `DateOnly` on the wire: an ISO date with no time.
    public var day: String
    public var totals: UsageTotals

    public init(
        day: String = "",
        totals: UsageTotals = UsageTotals()
    ) {
        self.day = day
        self.totals = totals
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        day = c.lenient(.day) ?? ""
        totals = c.lenient(.totals) ?? UsageTotals()
    }
}

public struct UsageBreakdown: Codable, Hashable, Sendable {
    public var providerKind: Int?
    public var connectionName: String?
    public var model: String
    public var totals: UsageTotals
    public var attributionQuality: UsageAttributionQuality

    public init(
        providerKind: Int? = nil,
        connectionName: String? = nil,
        model: String = "",
        totals: UsageTotals = UsageTotals(),
        attributionQuality: UsageAttributionQuality = UsageAttributionQuality(rawValue: 0)
    ) {
        self.providerKind = providerKind
        self.connectionName = connectionName
        self.model = model
        self.totals = totals
        self.attributionQuality = attributionQuality
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        providerKind = c.lenient(.providerKind)
        connectionName = c.lenient(.connectionName)
        model = c.lenient(.model) ?? ""
        totals = c.lenient(.totals) ?? UsageTotals()
        attributionQuality = c.lenient(.attributionQuality) ?? UsageAttributionQuality(rawValue: 0)
    }
}

public struct UsageDashboard: Codable, Hashable, Sendable {
    public var range: UsageRange
    public var totals: UsageTotals
    public var daily: [UsageBucket]
    public var breakdown: [UsageBreakdown]

    public init(
        range: UsageRange = UsageRange(rawValue: 0),
        totals: UsageTotals = UsageTotals(),
        daily: [UsageBucket] = [],
        breakdown: [UsageBreakdown] = []
    ) {
        self.range = range
        self.totals = totals
        self.daily = daily
        self.breakdown = breakdown
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        range = c.lenient(.range) ?? UsageRange(rawValue: 0)
        totals = c.lenient(.totals) ?? UsageTotals()
        daily = c.lenient(.daily) ?? []
        breakdown = c.lenient(.breakdown) ?? []
    }
}

/// Browser-safe advisory Codex allowance, per Codex connection. No token,
/// account or upstream payload crosses this seam — only what the plan's windows
/// say. `error` set means the refresh failed and this row is the reason, not
/// the numbers; `isStale` means what it says.
public struct CodexQuotaSummary: Codable, Hashable, Sendable {
    public var connectionId: String
    public var connectionName: String
    public var planType: String?
    public var windows: [LimitWindow]
    public var observedAt: String?
    public var isStale: Bool
    public var error: String?

    public init(
        connectionId: String = "",
        connectionName: String = "",
        planType: String? = nil,
        windows: [LimitWindow] = [],
        observedAt: String? = nil,
        isStale: Bool = false,
        error: String? = nil
    ) {
        self.connectionId = connectionId
        self.connectionName = connectionName
        self.planType = planType
        self.windows = windows
        self.observedAt = observedAt
        self.isStale = isStale
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        connectionId = c.lenient(.connectionId) ?? ""
        connectionName = c.lenient(.connectionName) ?? ""
        planType = c.lenient(.planType)
        windows = c.lenient(.windows) ?? []
        observedAt = c.lenient(.observedAt)
        isStale = c.lenient(.isStale) ?? false
        error = c.lenient(.error)
    }
}

/// One subscription connection's allowance — a ChatGPT plan behind Codex or a
/// Claude plan behind Claude Code. Mirrors `PlanQuotaSummary`.
public struct PlanQuotaSummary: Codable, Hashable, Sendable {
    public var connectionId: String
    public var connectionName: String
    public var planType: String?
    public var windows: [LimitWindow]
    public var observedAt: String?
    public var isStale: Bool
    public var error: String?
    public var kind: ProviderKind
    /// Whether asking again can learn anything new. Codex is polled from ChatGPT
    /// on request; a Claude plan is only ever observed — Claude Code reports its
    /// windows as it runs a turn — so it is as of the last turn on that connection.
    public var canRefresh: Bool

    public init(
        connectionId: String = "",
        connectionName: String = "",
        planType: String? = nil,
        windows: [LimitWindow] = [],
        observedAt: String? = nil,
        isStale: Bool = false,
        error: String? = nil,
        kind: ProviderKind = ProviderKind(rawValue: 0),
        canRefresh: Bool = false
    ) {
        self.connectionId = connectionId
        self.connectionName = connectionName
        self.planType = planType
        self.windows = windows
        self.observedAt = observedAt
        self.isStale = isStale
        self.error = error
        self.kind = kind
        self.canRefresh = canRefresh
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        connectionId = c.lenient(.connectionId) ?? ""
        connectionName = c.lenient(.connectionName) ?? ""
        planType = c.lenient(.planType)
        windows = c.lenient(.windows) ?? []
        observedAt = c.lenient(.observedAt)
        isStale = c.lenient(.isStale) ?? false
        error = c.lenient(.error)
        kind = c.lenient(.kind) ?? ProviderKind(rawValue: 0)
        canRefresh = c.lenient(.canRefresh) ?? false
    }
}

/// One matching moment in a past session: which session, when, who said it
/// ("user" | "assistant" — the server maps the event kinds), and a short
/// excerpt around the match. Scoped to the caller's own sessions.
public struct SessionSearchHit: Codable, Hashable, Sendable {
    public var sessionId: String
    public var sessionTitle: String
    public var when: String
    public var kind: String
    public var snippet: String
    /// Archived sessions stay searchable but can no longer be continued.
    public var archived: Bool?

    public init(
        sessionId: String = "",
        sessionTitle: String = "",
        when: String = "",
        kind: String = "",
        snippet: String = "",
        archived: Bool? = nil
    ) {
        self.sessionId = sessionId
        self.sessionTitle = sessionTitle
        self.when = when
        self.kind = kind
        self.snippet = snippet
        self.archived = archived
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = c.lenient(.sessionId) ?? ""
        sessionTitle = c.lenient(.sessionTitle) ?? ""
        when = c.lenient(.when) ?? ""
        kind = c.lenient(.kind) ?? ""
        snippet = c.lenient(.snippet) ?? ""
        archived = c.lenient(.archived)
    }
}

// ---- catalogs the create screen needs ----

public struct ModelCandidate: Codable, Hashable, Sendable {
    public var connectionId: String
    public var connectionName: String
    public var kind: Int
    public var modelId: String
    public var modelDisplayName: String
    public var tier: Int
    public var tierSource: Int
    public var contextWindowTokens: Int
    public var defaultThinkingLevel: ThinkingLevel?
    /// Effort levels only; null or empty means unknown, which offers every one.
    public var supportedThinkingLevels: [ThinkingLevel]?
    /// Thinking can't be switched off on this model, so Off isn't offered and runs as Low.
    public var alwaysThinks: Bool?
    /// `yyyy-MM-dd`, or null when the release isn't known. Newest sorts first within a tier.
    public var releaseDate: String?

    public init(
        connectionId: String = "",
        connectionName: String = "",
        kind: Int = 0,
        modelId: String = "",
        modelDisplayName: String = "",
        tier: Int = 0,
        tierSource: Int = 0,
        contextWindowTokens: Int = 0,
        defaultThinkingLevel: ThinkingLevel? = nil,
        supportedThinkingLevels: [ThinkingLevel]? = nil,
        alwaysThinks: Bool? = nil,
        releaseDate: String? = nil
    ) {
        self.connectionId = connectionId
        self.connectionName = connectionName
        self.kind = kind
        self.modelId = modelId
        self.modelDisplayName = modelDisplayName
        self.tier = tier
        self.tierSource = tierSource
        self.contextWindowTokens = contextWindowTokens
        self.defaultThinkingLevel = defaultThinkingLevel
        self.supportedThinkingLevels = supportedThinkingLevels
        self.alwaysThinks = alwaysThinks
        self.releaseDate = releaseDate
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        connectionId = c.lenient(.connectionId) ?? ""
        connectionName = c.lenient(.connectionName) ?? ""
        kind = c.lenient(.kind) ?? 0
        modelId = c.lenient(.modelId) ?? ""
        modelDisplayName = c.lenient(.modelDisplayName) ?? ""
        tier = c.lenient(.tier) ?? 0
        tierSource = c.lenient(.tierSource) ?? 0
        contextWindowTokens = c.lenient(.contextWindowTokens) ?? 0
        defaultThinkingLevel = c.lenient(.defaultThinkingLevel)
        supportedThinkingLevels = c.lenient(.supportedThinkingLevels)
        alwaysThinks = c.lenient(.alwaysThinks)
        releaseDate = c.lenient(.releaseDate)
    }
}

public struct GitRepoRow: Codable, Hashable, Sendable {
    public var fullName: String
    public var cloneUrl: String
    public var kind: GitServiceKind
    public var `private`: Bool

    public init(
        fullName: String = "",
        cloneUrl: String = "",
        kind: GitServiceKind = GitServiceKind(rawValue: 0),
        `private`: Bool = false
    ) {
        self.fullName = fullName
        self.cloneUrl = cloneUrl
        self.kind = kind
        self.`private` = `private`
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fullName = c.lenient(.fullName) ?? ""
        cloneUrl = c.lenient(.cloneUrl) ?? ""
        kind = c.lenient(.kind) ?? GitServiceKind(rawValue: 0)
        `private` = c.lenient(.`private`) ?? false
    }
}

public struct GitRepoListing: Codable, Hashable, Sendable {
    public var repos: [GitRepoRow]
    public var errors: [String]

    public init(
        repos: [GitRepoRow] = [],
        errors: [String] = []
    ) {
        self.repos = repos
        self.errors = errors
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        repos = c.lenient(.repos) ?? []
        errors = c.lenient(.errors) ?? []
    }
}

/// A recently used repository: the URL is the identity; label and kind are presentation.
public struct RecentRepo: Codable, Hashable, Sendable {
    public var cloneUrl: String
    public var label: String
    public var kind: GitServiceKind?

    public init(
        cloneUrl: String = "",
        label: String = "",
        kind: GitServiceKind? = nil
    ) {
        self.cloneUrl = cloneUrl
        self.label = label
        self.kind = kind
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cloneUrl = c.lenient(.cloneUrl) ?? ""
        label = c.lenient(.label) ?? ""
        kind = c.lenient(.kind)
    }
}

public struct NodeKeyKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let generated = NodeKeyKind(rawValue: 0)
    public static let pasted = NodeKeyKind(rawValue: 1)

    public static let allKnown: [NodeKeyKind] = [.generated, .pasted]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Generated"
        case 1: return "Pasted"
        default: return nil
        }
    }
}

/// Ported from `INodesApi.cs`. Carries the public key, never the private one.
public struct RemoteNodeSummary: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var host: String
    public var port: Int
    public var username: String
    public var keyKind: NodeKeyKind
    public var publicKey: String
    public var hostKeyFingerprint: String?
    public var enabled: Bool
    public var lastConnectedAt: String?
    public var lastError: String?
    public var createdAt: String

    public init(
        id: String = "",
        name: String = "",
        host: String = "",
        port: Int = 0,
        username: String = "",
        keyKind: NodeKeyKind = NodeKeyKind(rawValue: 0),
        publicKey: String = "",
        hostKeyFingerprint: String? = nil,
        enabled: Bool = false,
        lastConnectedAt: String? = nil,
        lastError: String? = nil,
        createdAt: String = ""
    ) {
        self.id = id
        self.name = name
        self.host = host
        self.port = port
        self.username = username
        self.keyKind = keyKind
        self.publicKey = publicKey
        self.hostKeyFingerprint = hostKeyFingerprint
        self.enabled = enabled
        self.lastConnectedAt = lastConnectedAt
        self.lastError = lastError
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        name = c.lenient(.name) ?? ""
        host = c.lenient(.host) ?? ""
        port = c.lenient(.port) ?? 0
        username = c.lenient(.username) ?? ""
        keyKind = c.lenient(.keyKind) ?? NodeKeyKind(rawValue: 0)
        publicKey = c.lenient(.publicKey) ?? ""
        hostKeyFingerprint = c.lenient(.hostKeyFingerprint)
        enabled = c.lenient(.enabled) ?? false
        lastConnectedAt = c.lenient(.lastConnectedAt)
        lastError = c.lenient(.lastError)
        createdAt = c.lenient(.createdAt) ?? ""
    }
}

/// A pasted private key travels once, in this body; null on a create means "generate one".
public struct RemoteNodeRequest: Codable, Hashable, Sendable {
    public var name: String
    public var host: String
    public var port: Int
    public var username: String
    public var privateKeyPem: String?

    public init(
        name: String = "",
        host: String = "",
        port: Int = 0,
        username: String = "",
        privateKeyPem: String? = nil
    ) {
        self.name = name
        self.host = host
        self.port = port
        self.username = username
        self.privateKeyPem = privateKeyPem
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lenient(.name) ?? ""
        host = c.lenient(.host) ?? ""
        port = c.lenient(.port) ?? 0
        username = c.lenient(.username) ?? ""
        privateKeyPem = c.lenient(.privateKeyPem)
    }
}

public struct NodeTestResult: Codable, Hashable, Sendable {
    public var ok: Bool
    public var detail: String

    public init(
        ok: Bool = false,
        detail: String = ""
    ) {
        self.ok = ok
        self.detail = detail
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = c.lenient(.ok) ?? false
        detail = c.lenient(.detail) ?? ""
    }
}

/// Creating a node answers its id, an error, or the line to install on the host.
public struct NodeCreateResult: Codable, Hashable, Sendable {
    public var id: String?
    public var error: String?
    public var authorizedKeysLine: String?

    public init(
        id: String? = nil,
        error: String? = nil,
        authorizedKeysLine: String? = nil
    ) {
        self.id = id
        self.error = error
        self.authorizedKeysLine = authorizedKeysLine
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id)
        error = c.lenient(.error)
        authorizedKeysLine = c.lenient(.authorizedKeysLine)
    }
}

public struct NodeKeyResult: Codable, Hashable, Sendable {
    public var authorizedKeysLine: String?
    public var error: String?

    public init(
        authorizedKeysLine: String? = nil,
        error: String? = nil
    ) {
        self.authorizedKeysLine = authorizedKeysLine
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        authorizedKeysLine = c.lenient(.authorizedKeysLine)
        error = c.lenient(.error)
    }
}

// ---- device auth (outside the seam) ----

public struct DeviceKey: Codable, Hashable, Sendable {
    public var fullKey: String
    public var userName: String

    public init(
        fullKey: String = "",
        userName: String = ""
    ) {
        self.fullKey = fullKey
        self.userName = userName
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fullKey = c.lenient(.fullKey) ?? ""
        userName = c.lenient(.userName) ?? ""
    }
}

public struct PasswordLoginRequest: Codable, Hashable, Sendable {
    public var userName: String
    public var password: String
    public var deviceName: String

    public init(
        userName: String = "",
        password: String = "",
        deviceName: String = ""
    ) {
        self.userName = userName
        self.password = password
        self.deviceName = deviceName
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userName = c.lenient(.userName) ?? ""
        password = c.lenient(.password) ?? ""
        deviceName = c.lenient(.deviceName) ?? ""
    }
}

public struct PairRequest: Codable, Hashable, Sendable {
    public var code: String
    public var deviceName: String

    public init(
        code: String = "",
        deviceName: String = ""
    ) {
        self.code = code
        self.deviceName = deviceName
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = c.lenient(.code) ?? ""
        deviceName = c.lenient(.deviceName) ?? ""
    }
}

/// What the server says went wrong, in a form worth branching on.
public struct LoginFailure: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let invalid = LoginFailure(rawValue: "invalid")
    public static let inactive = LoginFailure(rawValue: "inactive")
    public static let twofactor = LoginFailure(rawValue: "twofactor")
    public static let tooManyAttempts = LoginFailure(rawValue: "too-many-attempts")
}

public struct ServerProtocol: Codable, Hashable, Sendable {
    public var executor: Int
    public var version: String
    public var client: JSONValue?

    public init(
        executor: Int = 0,
        version: String = "",
        client: JSONValue? = nil
    ) {
        self.executor = executor
        self.version = version
        self.client = client
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        executor = c.lenient(.executor) ?? 0
        version = c.lenient(.version) ?? ""
        client = c.lenient(.client)
    }
}

// ---- routines ----
//
// Ported from `IAutomationsApi.cs`. The entities are called automations and the
// screens are called Routines; the seam keeps the old word in its paths and the
// new one in these read-shaped records, and so does this file.
//
// Two families over the same rows. `AutomationSummary` is the editable shape —
// every column, exactly as stored — and the rest are what the screens paint:
// already folded, already worded, so a phone is not left deriving "3rd failure
// in a row" or "Every weekday at 07:00" from a run log it would have to page
// through.

public struct AutomationKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    /// A routine somebody wrote: its prompt is whatever they typed.
    public static let job = AutomationKind(rawValue: 0)
    /// The one system-owned check-in per user. Its prompt is fixed.
    public static let heartbeat = AutomationKind(rawValue: 1)

    public static let allKnown: [AutomationKind] = [.job, .heartbeat]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Job"
        case 1: return "Heartbeat"
        default: return nil
        }
    }
}

public struct DeliveryKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let none = DeliveryKind(rawValue: 0)
    public static let push = DeliveryKind(rawValue: 1)
    public static let channel = DeliveryKind(rawValue: 2)

    public static let allKnown: [DeliveryKind] = [.none, .push, .channel]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "None"
        case 1: return "Push"
        case 2: return "Channel"
        default: return nil
        }
    }
}

public struct AutomationRunStatus: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let running = AutomationRunStatus(rawValue: 0)
    public static let completed = AutomationRunStatus(rawValue: 1)
    public static let failed = AutomationRunStatus(rawValue: 2)
    /// Not attempted: the session was busy, or the window had closed.
    public static let skipped = AutomationRunStatus(rawValue: 3)
    /// Completed with nothing to say — the agent answered `NO_REPLY`.
    public static let quiet = AutomationRunStatus(rawValue: 4)

    public static let allKnown: [AutomationRunStatus] = [.running, .completed, .failed, .skipped, .quiet]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Running"
        case 1: return "Completed"
        case 2: return "Failed"
        case 3: return "Skipped"
        case 4: return "Quiet"
        default: return nil
        }
    }
}

public struct AutomationRunTrigger: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let schedule = AutomationRunTrigger(rawValue: 0)
    public static let manual = AutomationRunTrigger(rawValue: 1)
    public static let channelCommand = AutomationRunTrigger(rawValue: 2)
    public static let email = AutomationRunTrigger(rawValue: 3)
    public static let webhook = AutomationRunTrigger(rawValue: 4)
    public static let heartbeat = AutomationRunTrigger(rawValue: 5)

    public static let allKnown: [AutomationRunTrigger] = [.schedule, .manual, .channelCommand, .email, .webhook, .heartbeat]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Schedule"
        case 1: return "Manual"
        case 2: return "ChannelCommand"
        case 3: return "Email"
        case 4: return "Webhook"
        case 5: return "Heartbeat"
        default: return nil
        }
    }
}

public struct AutomationTriggerKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let channelCommand = AutomationTriggerKind(rawValue: 0)
    public static let email = AutomationTriggerKind(rawValue: 1)
    public static let webhook = AutomationTriggerKind(rawValue: 2)
    public static let heartbeat = AutomationTriggerKind(rawValue: 3)

    public static let allKnown: [AutomationTriggerKind] = [.channelCommand, .email, .webhook, .heartbeat]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "ChannelCommand"
        case 1: return "Email"
        case 2: return "Webhook"
        case 3: return "Heartbeat"
        default: return nil
        }
    }
}

public struct ChannelKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let telegram = ChannelKind(rawValue: 0)
    public static let ntfy = ChannelKind(rawValue: 1)
    public static let discord = ChannelKind(rawValue: 2)
    public static let fluxer = ChannelKind(rawValue: 3)
    public static let email = ChannelKind(rawValue: 4)

    public static let allKnown: [ChannelKind] = [.telegram, .ntfy, .discord, .fluxer, .email]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Telegram"
        case 1: return "Ntfy"
        case 2: return "Discord"
        case 3: return "Fluxer"
        case 4: return "Email"
        default: return nil
        }
    }
}

/// Three outcomes rather than five statuses, because a bar and a dot can only
/// carry three: did it say something, was it quiet, did it break. A run still
/// going has no outcome at all.
public struct RunOutcome: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let notified = RunOutcome(rawValue: 0)
    public static let quiet = RunOutcome(rawValue: 1)
    public static let failed = RunOutcome(rawValue: 2)

    public static let allKnown: [RunOutcome] = [.notified, .quiet, .failed]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Notified"
        case 1: return "Quiet"
        case 2: return "Failed"
        default: return nil
        }
    }
}

public struct AutomationTrigger: Codable, Hashable, Sendable {
    public var kind: AutomationTriggerKind
    public var channelId: String?
    public var match: String?
    /// Always blank on a read: the server stores the hash, never the secret.
    public var secret: String?
    public var id: String
    public var enabled: Bool

    public init(
        kind: AutomationTriggerKind = AutomationTriggerKind(rawValue: 0),
        channelId: String? = nil,
        match: String? = nil,
        secret: String? = nil,
        id: String = "",
        enabled: Bool = false
    ) {
        self.kind = kind
        self.channelId = channelId
        self.match = match
        self.secret = secret
        self.id = id
        self.enabled = enabled
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.lenient(.kind) ?? AutomationTriggerKind(rawValue: 0)
        channelId = c.lenient(.channelId)
        match = c.lenient(.match)
        secret = c.lenient(.secret)
        id = c.lenient(.id) ?? ""
        enabled = c.lenient(.enabled) ?? false
    }
}

public struct AutomationSummary: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var kind: AutomationKind
    public var prompt: String
    public var cronExpression: String
    public var timeZoneId: String
    public var enabled: Bool
    public var scheduleEnabled: Bool
    public var facet: String?
    public var model: String?
    public var repoUrls: [String]
    public var nodeIds: [String]
    public var continuity: Bool
    public var notepad: String
    /// "07:00:00" — a `TimeOnly`, not a timestamp.
    public var activeHoursStart: String?
    public var activeHoursEnd: String?
    public var deliveryKind: DeliveryKind
    public var deliveryTargetId: String?
    public var triggers: [AutomationTrigger]
    public var sessionId: String?
    public var nextRunAt: String?
    public var lastRunAt: String?
    public var lastStatus: String?
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String = "",
        name: String = "",
        kind: AutomationKind = AutomationKind(rawValue: 0),
        prompt: String = "",
        cronExpression: String = "",
        timeZoneId: String = "",
        enabled: Bool = false,
        scheduleEnabled: Bool = false,
        facet: String? = nil,
        model: String? = nil,
        repoUrls: [String] = [],
        nodeIds: [String] = [],
        continuity: Bool = false,
        notepad: String = "",
        activeHoursStart: String? = nil,
        activeHoursEnd: String? = nil,
        deliveryKind: DeliveryKind = DeliveryKind(rawValue: 0),
        deliveryTargetId: String? = nil,
        triggers: [AutomationTrigger] = [],
        sessionId: String? = nil,
        nextRunAt: String? = nil,
        lastRunAt: String? = nil,
        lastStatus: String? = nil,
        createdAt: String = "",
        updatedAt: String = ""
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.prompt = prompt
        self.cronExpression = cronExpression
        self.timeZoneId = timeZoneId
        self.enabled = enabled
        self.scheduleEnabled = scheduleEnabled
        self.facet = facet
        self.model = model
        self.repoUrls = repoUrls
        self.nodeIds = nodeIds
        self.continuity = continuity
        self.notepad = notepad
        self.activeHoursStart = activeHoursStart
        self.activeHoursEnd = activeHoursEnd
        self.deliveryKind = deliveryKind
        self.deliveryTargetId = deliveryTargetId
        self.triggers = triggers
        self.sessionId = sessionId
        self.nextRunAt = nextRunAt
        self.lastRunAt = lastRunAt
        self.lastStatus = lastStatus
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        name = c.lenient(.name) ?? ""
        kind = c.lenient(.kind) ?? AutomationKind(rawValue: 0)
        prompt = c.lenient(.prompt) ?? ""
        cronExpression = c.lenient(.cronExpression) ?? ""
        timeZoneId = c.lenient(.timeZoneId) ?? ""
        enabled = c.lenient(.enabled) ?? false
        scheduleEnabled = c.lenient(.scheduleEnabled) ?? false
        facet = c.lenient(.facet)
        model = c.lenient(.model)
        repoUrls = c.lenient(.repoUrls) ?? []
        nodeIds = c.lenient(.nodeIds) ?? []
        continuity = c.lenient(.continuity) ?? false
        notepad = c.lenient(.notepad) ?? ""
        activeHoursStart = c.lenient(.activeHoursStart)
        activeHoursEnd = c.lenient(.activeHoursEnd)
        deliveryKind = c.lenient(.deliveryKind) ?? DeliveryKind(rawValue: 0)
        deliveryTargetId = c.lenient(.deliveryTargetId)
        triggers = c.lenient(.triggers) ?? []
        sessionId = c.lenient(.sessionId)
        nextRunAt = c.lenient(.nextRunAt)
        lastRunAt = c.lenient(.lastRunAt)
        lastStatus = c.lenient(.lastStatus)
        createdAt = c.lenient(.createdAt) ?? ""
        updatedAt = c.lenient(.updatedAt) ?? ""
    }
}

/// One run, as every Routines surface shows it.
public struct RunSummary: Codable, Hashable, Sendable {
    public var id: String
    public var routineId: String
    public var routineName: String
    public var startedAt: String
    public var finishedAt: String?
    public var status: AutomationRunStatus
    /// Null while it is still running — that is the pulsing dot, not a colour.
    public var outcome: RunOutcome?
    public var durationMs: Double?
    /// The first line of the answer, bounded, or the error when it failed.
    public var said: String?
    public var error: String?
    public var delivered: Bool
    public var trigger: AutomationRunTrigger
    public var triggerId: String?
    public var triggerSource: String?
    public var retryOfRunId: String?

    public init(
        id: String = "",
        routineId: String = "",
        routineName: String = "",
        startedAt: String = "",
        finishedAt: String? = nil,
        status: AutomationRunStatus = AutomationRunStatus(rawValue: 0),
        outcome: RunOutcome? = nil,
        durationMs: Double? = nil,
        said: String? = nil,
        error: String? = nil,
        delivered: Bool = false,
        trigger: AutomationRunTrigger = AutomationRunTrigger(rawValue: 0),
        triggerId: String? = nil,
        triggerSource: String? = nil,
        retryOfRunId: String? = nil
    ) {
        self.id = id
        self.routineId = routineId
        self.routineName = routineName
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.status = status
        self.outcome = outcome
        self.durationMs = durationMs
        self.said = said
        self.error = error
        self.delivered = delivered
        self.trigger = trigger
        self.triggerId = triggerId
        self.triggerSource = triggerSource
        self.retryOfRunId = retryOfRunId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        routineId = c.lenient(.routineId) ?? ""
        routineName = c.lenient(.routineName) ?? ""
        startedAt = c.lenient(.startedAt) ?? ""
        finishedAt = c.lenient(.finishedAt)
        status = c.lenient(.status) ?? AutomationRunStatus(rawValue: 0)
        outcome = c.lenient(.outcome)
        durationMs = c.lenient(.durationMs)
        said = c.lenient(.said)
        error = c.lenient(.error)
        delivered = c.lenient(.delivered) ?? false
        trigger = c.lenient(.trigger) ?? AutomationRunTrigger(rawValue: 0)
        triggerId = c.lenient(.triggerId)
        triggerSource = c.lenient(.triggerSource)
        retryOfRunId = c.lenient(.retryOfRunId)
    }
}

public struct NextFire: Codable, Hashable, Sendable {
    public var routineId: String
    public var name: String
    public var at: String

    public init(
        routineId: String = "",
        name: String = "",
        at: String = ""
    ) {
        self.routineId = routineId
        self.name = name
        self.at = at
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        routineId = c.lenient(.routineId) ?? ""
        name = c.lenient(.name) ?? ""
        at = c.lenient(.at) ?? ""
    }
}

public struct RoutineCard: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var kind: AutomationKind
    public var enabled: Bool
    public var scheduleEnabled: Bool
    /// The schedule in words, or what starts it when there is no clock.
    public var scheduleSentence: String
    /// The mono second line: "0 7 * * 1-5 · Europe/Berlin".
    public var scheduleMeta: String
    /// Exactly 14, oldest first, left-padded with nulls. Null is "no run".
    public var history: [RunOutcome?]
    public var lastRun: RunSummary?
    public var nextFire: String?
    public var lastFailed: Bool
    public var running: Bool
    public var triggerCount: Int

    public init(
        id: String = "",
        name: String = "",
        kind: AutomationKind = AutomationKind(rawValue: 0),
        enabled: Bool = false,
        scheduleEnabled: Bool = false,
        scheduleSentence: String = "",
        scheduleMeta: String = "",
        history: [RunOutcome?] = [],
        lastRun: RunSummary? = nil,
        nextFire: String? = nil,
        lastFailed: Bool = false,
        running: Bool = false,
        triggerCount: Int = 0
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.enabled = enabled
        self.scheduleEnabled = scheduleEnabled
        self.scheduleSentence = scheduleSentence
        self.scheduleMeta = scheduleMeta
        self.history = history
        self.lastRun = lastRun
        self.nextFire = nextFire
        self.lastFailed = lastFailed
        self.running = running
        self.triggerCount = triggerCount
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        name = c.lenient(.name) ?? ""
        kind = c.lenient(.kind) ?? AutomationKind(rawValue: 0)
        enabled = c.lenient(.enabled) ?? false
        scheduleEnabled = c.lenient(.scheduleEnabled) ?? false
        scheduleSentence = c.lenient(.scheduleSentence) ?? ""
        scheduleMeta = c.lenient(.scheduleMeta) ?? ""
        history = c.lenient(.history) ?? []
        lastRun = c.lenient(.lastRun)
        nextFire = c.lenient(.nextFire)
        lastFailed = c.lenient(.lastFailed) ?? false
        running = c.lenient(.running) ?? false
        triggerCount = c.lenient(.triggerCount) ?? 0
    }
}

public struct RoutineFailure: Codable, Hashable, Sendable {
    public var routineId: String
    public var name: String
    public var runId: String
    public var at: String
    public var error: String?
    public var durationMs: Double?
    /// Consecutive failures back from the latest finished run. At least 1.
    public var streak: Int

    public init(
        routineId: String = "",
        name: String = "",
        runId: String = "",
        at: String = "",
        error: String? = nil,
        durationMs: Double? = nil,
        streak: Int = 0
    ) {
        self.routineId = routineId
        self.name = name
        self.runId = runId
        self.at = at
        self.error = error
        self.durationMs = durationMs
        self.streak = streak
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        routineId = c.lenient(.routineId) ?? ""
        name = c.lenient(.name) ?? ""
        runId = c.lenient(.runId) ?? ""
        at = c.lenient(.at) ?? ""
        error = c.lenient(.error)
        durationMs = c.lenient(.durationMs)
        streak = c.lenient(.streak) ?? 0
    }
}

public struct HeartbeatStatus: Codable, Hashable, Sendable {
    public var id: String
    public var enabled: Bool
    public var intervalSentence: String
    public var activeStart: String?
    public var activeEnd: String?
    public var nextFire: String?
    public var notepadItems: [String]
    public var quietToday: Int
    public var notifiedToday: Int
    public var running: Bool

    public init(
        id: String = "",
        enabled: Bool = false,
        intervalSentence: String = "",
        activeStart: String? = nil,
        activeEnd: String? = nil,
        nextFire: String? = nil,
        notepadItems: [String] = [],
        quietToday: Int = 0,
        notifiedToday: Int = 0,
        running: Bool = false
    ) {
        self.id = id
        self.enabled = enabled
        self.intervalSentence = intervalSentence
        self.activeStart = activeStart
        self.activeEnd = activeEnd
        self.nextFire = nextFire
        self.notepadItems = notepadItems
        self.quietToday = quietToday
        self.notifiedToday = notifiedToday
        self.running = running
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        enabled = c.lenient(.enabled) ?? false
        intervalSentence = c.lenient(.intervalSentence) ?? ""
        activeStart = c.lenient(.activeStart)
        activeEnd = c.lenient(.activeEnd)
        nextFire = c.lenient(.nextFire)
        notepadItems = c.lenient(.notepadItems) ?? []
        quietToday = c.lenient(.quietToday) ?? 0
        notifiedToday = c.lenient(.notifiedToday) ?? 0
        running = c.lenient(.running) ?? false
    }
}

/// Everything the board paints, in one call.
public struct RoutineBoard: Codable, Hashable, Sendable {
    public var routines: [RoutineCard]
    public var failures: [RoutineFailure]
    /// Null until the user has one; the board never creates it by itself.
    public var heartbeat: HeartbeatStatus?
    public var runsToday: Int
    public var notifiedToday: Int
    public var quietToday: Int
    public var failedToday: Int
    public var upcoming: [NextFire]
    /// The phone's ledger: the last runs across every routine, newest first.
    public var recentRuns: [RunSummary]?

    public init(
        routines: [RoutineCard] = [],
        failures: [RoutineFailure] = [],
        heartbeat: HeartbeatStatus? = nil,
        runsToday: Int = 0,
        notifiedToday: Int = 0,
        quietToday: Int = 0,
        failedToday: Int = 0,
        upcoming: [NextFire] = [],
        recentRuns: [RunSummary]? = nil
    ) {
        self.routines = routines
        self.failures = failures
        self.heartbeat = heartbeat
        self.runsToday = runsToday
        self.notifiedToday = notifiedToday
        self.quietToday = quietToday
        self.failedToday = failedToday
        self.upcoming = upcoming
        self.recentRuns = recentRuns
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        routines = c.lenient(.routines) ?? []
        failures = c.lenient(.failures) ?? []
        heartbeat = c.lenient(.heartbeat)
        runsToday = c.lenient(.runsToday) ?? 0
        notifiedToday = c.lenient(.notifiedToday) ?? 0
        quietToday = c.lenient(.quietToday) ?? 0
        failedToday = c.lenient(.failedToday) ?? 0
        upcoming = c.lenient(.upcoming) ?? []
        recentRuns = c.lenient(.recentRuns)
    }
}

/// The cheap read behind the sessions screen's strip.
public struct RoutineStatus: Codable, Hashable, Sendable {
    public var anyRoutines: Bool
    public var anyFailed: Bool
    public var newestFailure: RoutineFailure?
    public var latestNotified: RunSummary?
    public var upcoming: [NextFire]

    public init(
        anyRoutines: Bool = false,
        anyFailed: Bool = false,
        newestFailure: RoutineFailure? = nil,
        latestNotified: RunSummary? = nil,
        upcoming: [NextFire] = []
    ) {
        self.anyRoutines = anyRoutines
        self.anyFailed = anyFailed
        self.newestFailure = newestFailure
        self.latestNotified = latestNotified
        self.upcoming = upcoming
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        anyRoutines = c.lenient(.anyRoutines) ?? false
        anyFailed = c.lenient(.anyFailed) ?? false
        newestFailure = c.lenient(.newestFailure)
        latestNotified = c.lenient(.latestNotified)
        upcoming = c.lenient(.upcoming) ?? []
    }
}

public struct TriggerStats: Codable, Hashable, Sendable {
    /// The trigger's own id — or the routine's, for the synthesized schedule.
    public var triggerId: String
    /// Null for that synthesized schedule.
    public var kind: AutomationTriggerKind?
    public var enabled: Bool
    public var summary: String
    public var note: String
    public var lastFired: String?
    public var lastFiredBy: String?
    public var fires30d: Int
    public var history: [RunOutcome?]
    public var channel: ChannelKind?

    public init(
        triggerId: String = "",
        kind: AutomationTriggerKind? = nil,
        enabled: Bool = false,
        summary: String = "",
        note: String = "",
        lastFired: String? = nil,
        lastFiredBy: String? = nil,
        fires30d: Int = 0,
        history: [RunOutcome?] = [],
        channel: ChannelKind? = nil
    ) {
        self.triggerId = triggerId
        self.kind = kind
        self.enabled = enabled
        self.summary = summary
        self.note = note
        self.lastFired = lastFired
        self.lastFiredBy = lastFiredBy
        self.fires30d = fires30d
        self.history = history
        self.channel = channel
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        triggerId = c.lenient(.triggerId) ?? ""
        kind = c.lenient(.kind)
        enabled = c.lenient(.enabled) ?? false
        summary = c.lenient(.summary) ?? ""
        note = c.lenient(.note) ?? ""
        lastFired = c.lenient(.lastFired)
        lastFiredBy = c.lenient(.lastFiredBy)
        fires30d = c.lenient(.fires30d) ?? 0
        history = c.lenient(.history) ?? []
        channel = c.lenient(.channel)
    }
}

public struct RoutineDetail: Codable, Hashable, Sendable {
    public var routine: AutomationSummary
    public var scheduleSentence: String
    public var scheduleMeta: String
    public var nextFire: String?
    /// Where an unprompted run's answer goes: "your browser", "nobody (log only)".
    public var notifiesLabel: String
    /// Thirty entries, oldest first, left-padded with nulls.
    public var history: [RunOutcome?]
    public var runs30d: Int
    public var notified30d: Int
    public var failed30d: Int
    public var medianDurationMs: Double?
    public var triggers: [TriggerStats]
    public var lastRun: RunSummary?
    public var running: Bool

    public init(
        routine: AutomationSummary = AutomationSummary(),
        scheduleSentence: String = "",
        scheduleMeta: String = "",
        nextFire: String? = nil,
        notifiesLabel: String = "",
        history: [RunOutcome?] = [],
        runs30d: Int = 0,
        notified30d: Int = 0,
        failed30d: Int = 0,
        medianDurationMs: Double? = nil,
        triggers: [TriggerStats] = [],
        lastRun: RunSummary? = nil,
        running: Bool = false
    ) {
        self.routine = routine
        self.scheduleSentence = scheduleSentence
        self.scheduleMeta = scheduleMeta
        self.nextFire = nextFire
        self.notifiesLabel = notifiesLabel
        self.history = history
        self.runs30d = runs30d
        self.notified30d = notified30d
        self.failed30d = failed30d
        self.medianDurationMs = medianDurationMs
        self.triggers = triggers
        self.lastRun = lastRun
        self.running = running
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        routine = c.lenient(.routine) ?? AutomationSummary()
        scheduleSentence = c.lenient(.scheduleSentence) ?? ""
        scheduleMeta = c.lenient(.scheduleMeta) ?? ""
        nextFire = c.lenient(.nextFire)
        notifiesLabel = c.lenient(.notifiesLabel) ?? ""
        history = c.lenient(.history) ?? []
        runs30d = c.lenient(.runs30d) ?? 0
        notified30d = c.lenient(.notified30d) ?? 0
        failed30d = c.lenient(.failed30d) ?? 0
        medianDurationMs = c.lenient(.medianDurationMs)
        triggers = c.lenient(.triggers) ?? []
        lastRun = c.lenient(.lastRun)
        running = c.lenient(.running) ?? false
    }
}

public struct RunPage: Codable, Hashable, Sendable {
    public var runs: [RunSummary]
    public var total: Int

    public init(
        runs: [RunSummary] = [],
        total: Int = 0
    ) {
        self.runs = runs
        self.total = total
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        runs = c.lenient(.runs) ?? []
        total = c.lenient(.total) ?? 0
    }
}

/// One tool call in a run's replayed transcript.
public struct RunStep: Codable, Hashable, Sendable {
    /// The tool's name.
    public var symbol: String
    /// Its most telling argument — a path, a command, a query.
    public var name: String
    public var meta: String?
    public var ok: Bool

    public init(
        symbol: String = "",
        name: String = "",
        meta: String? = nil,
        ok: Bool = false
    ) {
        self.symbol = symbol
        self.name = name
        self.meta = meta
        self.ok = ok
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        symbol = c.lenient(.symbol) ?? ""
        name = c.lenient(.name) ?? ""
        meta = c.lenient(.meta)
        ok = c.lenient(.ok) ?? false
    }
}

public struct RunDetail: Codable, Hashable, Sendable {
    public var run: RunSummary
    public var sessionId: String?
    public var model: String?
    public var inputTokens: Int?
    public var outputTokens: Int?
    public var estimatedCost: Double?
    public var steps: [RunStep]
    public var finalMessage: String?
    public var endedAt: String?

    public init(
        run: RunSummary = RunSummary(),
        sessionId: String? = nil,
        model: String? = nil,
        inputTokens: Int? = nil,
        outputTokens: Int? = nil,
        estimatedCost: Double? = nil,
        steps: [RunStep] = [],
        finalMessage: String? = nil,
        endedAt: String? = nil
    ) {
        self.run = run
        self.sessionId = sessionId
        self.model = model
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.estimatedCost = estimatedCost
        self.steps = steps
        self.finalMessage = finalMessage
        self.endedAt = endedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        run = c.lenient(.run) ?? RunSummary()
        sessionId = c.lenient(.sessionId)
        model = c.lenient(.model)
        inputTokens = c.lenient(.inputTokens)
        outputTokens = c.lenient(.outputTokens)
        estimatedCost = c.lenient(.estimatedCost)
        steps = c.lenient(.steps) ?? []
        finalMessage = c.lenient(.finalMessage)
        endedAt = c.lenient(.endedAt)
    }
}

// ---- authoring a routine ----
//
// The editable half, ported from the same file. `AutomationDraft` is what a
// create or an update sends; the server answers with the problem to show or
// the webhook secrets that write minted, which is the one moment they are
// readable.

public let emptyGuid = "00000000-0000-0000-0000-000000000000"

/// The editable half of a routine. `cronExpression` may be blank when
/// `triggers` holds at least one; the heartbeat's `prompt` is ignored.
/// `activeHoursStart`/`End` are `TimeOnly`s: "07:00:00", never a timestamp.
public struct AutomationDraft: Codable, Hashable, Sendable {
    public var name: String
    public var prompt: String
    public var cronExpression: String
    public var timeZoneId: String
    public var enabled: Bool
    public var facet: String?
    public var model: String?
    public var repoUrls: [String]
    public var continuity: Bool
    public var activeHoursStart: String?
    public var activeHoursEnd: String?
    public var deliveryKind: DeliveryKind
    public var deliveryTargetId: String?
    public var triggers: [AutomationTrigger]
    public var scheduleEnabled: Bool
    public var nodeIds: [String]

    public init(
        name: String = "",
        prompt: String = "",
        cronExpression: String = "",
        timeZoneId: String = "",
        enabled: Bool = false,
        facet: String? = nil,
        model: String? = nil,
        repoUrls: [String] = [],
        continuity: Bool = false,
        activeHoursStart: String? = nil,
        activeHoursEnd: String? = nil,
        deliveryKind: DeliveryKind = DeliveryKind(rawValue: 0),
        deliveryTargetId: String? = nil,
        triggers: [AutomationTrigger] = [],
        scheduleEnabled: Bool = false,
        nodeIds: [String] = []
    ) {
        self.name = name
        self.prompt = prompt
        self.cronExpression = cronExpression
        self.timeZoneId = timeZoneId
        self.enabled = enabled
        self.facet = facet
        self.model = model
        self.repoUrls = repoUrls
        self.continuity = continuity
        self.activeHoursStart = activeHoursStart
        self.activeHoursEnd = activeHoursEnd
        self.deliveryKind = deliveryKind
        self.deliveryTargetId = deliveryTargetId
        self.triggers = triggers
        self.scheduleEnabled = scheduleEnabled
        self.nodeIds = nodeIds
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lenient(.name) ?? ""
        prompt = c.lenient(.prompt) ?? ""
        cronExpression = c.lenient(.cronExpression) ?? ""
        timeZoneId = c.lenient(.timeZoneId) ?? ""
        enabled = c.lenient(.enabled) ?? false
        facet = c.lenient(.facet)
        model = c.lenient(.model)
        repoUrls = c.lenient(.repoUrls) ?? []
        continuity = c.lenient(.continuity) ?? false
        activeHoursStart = c.lenient(.activeHoursStart)
        activeHoursEnd = c.lenient(.activeHoursEnd)
        deliveryKind = c.lenient(.deliveryKind) ?? DeliveryKind(rawValue: 0)
        deliveryTargetId = c.lenient(.deliveryTargetId)
        triggers = c.lenient(.triggers) ?? []
        scheduleEnabled = c.lenient(.scheduleEnabled) ?? false
        nodeIds = c.lenient(.nodeIds) ?? []
    }
}

/// A webhook secret, handed back exactly once by the write that minted it.
public struct AutomationWebhookSecret: Codable, Hashable, Sendable {
    public var automationId: String
    public var triggerId: String
    public var secret: String

    public init(
        automationId: String = "",
        triggerId: String = "",
        secret: String = ""
    ) {
        self.automationId = automationId
        self.triggerId = triggerId
        self.secret = secret
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        automationId = c.lenient(.automationId) ?? ""
        triggerId = c.lenient(.triggerId) ?? ""
        secret = c.lenient(.secret) ?? ""
    }
}

/// The outcome of a create or an update: a problem, or the secrets it minted.
public struct AutomationSaveResult: Codable, Hashable, Sendable {
    public var error: String?
    public var webhooks: [AutomationWebhookSecret]

    public init(
        error: String? = nil,
        webhooks: [AutomationWebhookSecret] = []
    ) {
        self.error = error
        self.webhooks = webhooks
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        error = c.lenient(.error)
        webhooks = c.lenient(.webhooks) ?? []
    }
}

/// What the server made of a schedule somebody typed.
public struct ScheduleParse: Codable, Hashable, Sendable {
    public var ok: Bool
    public var cron: String?
    public var zone: String?
    /// The cron read back in words, for the ✓ line.
    public var sentence: String?
    /// When it would next fire, ignoring active hours.
    public var firstRun: String?
    public var error: String?

    public init(
        ok: Bool = false,
        cron: String? = nil,
        zone: String? = nil,
        sentence: String? = nil,
        firstRun: String? = nil,
        error: String? = nil
    ) {
        self.ok = ok
        self.cron = cron
        self.zone = zone
        self.sentence = sentence
        self.firstRun = firstRun
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = c.lenient(.ok) ?? false
        cron = c.lenient(.cron)
        zone = c.lenient(.zone)
        sentence = c.lenient(.sentence)
        firstRun = c.lenient(.firstRun)
        error = c.lenient(.error)
    }
}

public struct ScheduleParseRequest: Codable, Hashable, Sendable {
    public var text: String
    public var timeZoneId: String?

    public init(
        text: String = "",
        timeZoneId: String? = nil
    ) {
        self.text = text
        self.timeZoneId = timeZoneId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.lenient(.text) ?? ""
        timeZoneId = c.lenient(.timeZoneId)
    }
}

public struct RoutineDraftRequest: Codable, Hashable, Sendable {
    public var description: String
    public var timeZoneId: String?

    public init(
        description: String = "",
        timeZoneId: String? = nil
    ) {
        self.description = description
        self.timeZoneId = timeZoneId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        description = c.lenient(.description) ?? ""
        timeZoneId = c.lenient(.timeZoneId)
    }
}

/// One trigger a draft proposes; a null `kind` is the schedule, and `when` its English.
public struct RoutineDraftTrigger: Codable, Hashable, Sendable {
    public var kind: AutomationTriggerKind?
    public var when: String?
    public var channelId: String?
    public var match: String?

    public init(
        kind: AutomationTriggerKind? = nil,
        when: String? = nil,
        channelId: String? = nil,
        match: String? = nil
    ) {
        self.kind = kind
        self.when = when
        self.channelId = channelId
        self.match = match
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.lenient(.kind)
        when = c.lenient(.when)
        channelId = c.lenient(.channelId)
        match = c.lenient(.match)
    }
}

/// A routine drafted from a description. Best-effort by construction: `ok` is
/// false and the form simply stays as it was when no model could draft it.
public struct RoutineDraftResult: Codable, Hashable, Sendable {
    public var ok: Bool
    public var error: String?
    public var name: String?
    public var prompt: String?
    public var model: String?
    public var triggers: [RoutineDraftTrigger]
    public var deliveryKind: DeliveryKind
    public var deliveryTargetId: String?
    /// The "the agent read this as" lines, already worded.
    public var reading: [String]
    public var elapsedMs: Int
    public var draftedBy: String?

    public init(
        ok: Bool = false,
        error: String? = nil,
        name: String? = nil,
        prompt: String? = nil,
        model: String? = nil,
        triggers: [RoutineDraftTrigger] = [],
        deliveryKind: DeliveryKind = DeliveryKind(rawValue: 0),
        deliveryTargetId: String? = nil,
        reading: [String] = [],
        elapsedMs: Int = 0,
        draftedBy: String? = nil
    ) {
        self.ok = ok
        self.error = error
        self.name = name
        self.prompt = prompt
        self.model = model
        self.triggers = triggers
        self.deliveryKind = deliveryKind
        self.deliveryTargetId = deliveryTargetId
        self.reading = reading
        self.elapsedMs = elapsedMs
        self.draftedBy = draftedBy
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = c.lenient(.ok) ?? false
        error = c.lenient(.error)
        name = c.lenient(.name)
        prompt = c.lenient(.prompt)
        model = c.lenient(.model)
        triggers = c.lenient(.triggers) ?? []
        deliveryKind = c.lenient(.deliveryKind) ?? DeliveryKind(rawValue: 0)
        deliveryTargetId = c.lenient(.deliveryTargetId)
        reading = c.lenient(.reading) ?? []
        elapsedMs = c.lenient(.elapsedMs) ?? 0
        draftedBy = c.lenient(.draftedBy)
    }
}

// ---- channels ----
//
// Ported from `IChannelsApi.cs`. The editor needs them twice: a chat command
// or an email trigger listens on one, and a run's answer can be delivered to
// one. Never carries the bot token — only whether one is set.

public struct PendingPairing: Codable, Hashable, Sendable {
    public var peerId: String
    public var code: String
    public var issuedAt: String

    public init(
        peerId: String = "",
        code: String = "",
        issuedAt: String = ""
    ) {
        self.peerId = peerId
        self.code = code
        self.issuedAt = issuedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        peerId = c.lenient(.peerId) ?? ""
        code = c.lenient(.code) ?? ""
        issuedAt = c.lenient(.issuedAt) ?? ""
    }
}

public struct ChannelSummary: Codable, Hashable, Sendable {
    public var id: String
    public var kind: ChannelKind
    public var displayName: String
    public var enabled: Bool
    public var hasSecret: Bool
    public var settings: String
    public var pairedPeers: [String]
    public var pendingPairings: [PendingPairing]
    public var mainSessionId: String?
    public var lastError: String?
    public var lastSeenAt: String?
    public var createdAt: String

    public init(
        id: String = "",
        kind: ChannelKind = ChannelKind(rawValue: 0),
        displayName: String = "",
        enabled: Bool = false,
        hasSecret: Bool = false,
        settings: String = "",
        pairedPeers: [String] = [],
        pendingPairings: [PendingPairing] = [],
        mainSessionId: String? = nil,
        lastError: String? = nil,
        lastSeenAt: String? = nil,
        createdAt: String = ""
    ) {
        self.id = id
        self.kind = kind
        self.displayName = displayName
        self.enabled = enabled
        self.hasSecret = hasSecret
        self.settings = settings
        self.pairedPeers = pairedPeers
        self.pendingPairings = pendingPairings
        self.mainSessionId = mainSessionId
        self.lastError = lastError
        self.lastSeenAt = lastSeenAt
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        kind = c.lenient(.kind) ?? ChannelKind(rawValue: 0)
        displayName = c.lenient(.displayName) ?? ""
        enabled = c.lenient(.enabled) ?? false
        hasSecret = c.lenient(.hasSecret) ?? false
        settings = c.lenient(.settings) ?? ""
        pairedPeers = c.lenient(.pairedPeers) ?? []
        pendingPairings = c.lenient(.pendingPairings) ?? []
        mainSessionId = c.lenient(.mainSessionId)
        lastError = c.lenient(.lastError)
        lastSeenAt = c.lenient(.lastSeenAt)
        createdAt = c.lenient(.createdAt) ?? ""
    }
}

// ---- settings ----
//
// Everything `/settings/*` edits on the web, ported from the `I*Api.cs`
// contracts each page injects. Secrets go out in a request body and never
// come back: a summary says `hasSecret`/`hasSecrets`, a key answers its prefix.

/// The two-field answer a create gives: one of the two is set. When
/// `needsModelCatalog` is true the endpoint answered but won't enumerate its
/// models — the form should ask for a catalog rather than report a bad key.
public struct CreateResult: Codable, Hashable, Sendable {
    public var id: String?
    public var error: String?
    public var needsModelCatalog: Bool?

    public init(
        id: String? = nil,
        error: String? = nil,
        needsModelCatalog: Bool? = nil
    ) {
        self.id = id
        self.error = error
        self.needsModelCatalog = needsModelCatalog
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id)
        error = c.lenient(.error)
        needsModelCatalog = c.lenient(.needsModelCatalog)
    }
}

/// `{value}` — null is success, a string is the problem to show.
public struct TextResult: Codable, Hashable, Sendable {
    public var value: String?

    public init(
        value: String? = nil
    ) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        value = c.lenient(.value)
    }
}

public struct ProviderKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let anthropic = ProviderKind(rawValue: 0)
    public static let openAICompatible = ProviderKind(rawValue: 1)
    public static let openAICodex = ProviderKind(rawValue: 2)
    public static let claudeCode = ProviderKind(rawValue: 3)
    /// A Kimi Code membership, over the plan's OpenAI-compatible endpoint.
    public static let kimiCode = ProviderKind(rawValue: 4)

    public static let allKnown: [ProviderKind] = [.anthropic, .openAICompatible, .openAICodex, .claudeCode, .kimiCode]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Anthropic"
        case 1: return "OpenAICompatible"
        case 2: return "OpenAICodex"
        case 3: return "ClaudeCode"
        case 4: return "KimiCode"
        default: return nil
        }
    }
}

public enum KimiCodeEndpoints {
    public static let `default` = "https://api.kimi.com/coding/v1"
    public static let overseas = "https://api.kimi.ai/coding/v1"
}

public struct ModelTier: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let simple = ModelTier(rawValue: 0)
    public static let medium = ModelTier(rawValue: 1)
    public static let complex = ModelTier(rawValue: 2)
    public static let reasoning = ModelTier(rawValue: 3)

    public static let allKnown: [ModelTier] = [.simple, .medium, .complex, .reasoning]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Simple"
        case 1: return "Medium"
        case 2: return "Complex"
        case 3: return "Reasoning"
        default: return nil
        }
    }
}

public struct ConnectionSummary: Codable, Hashable, Sendable {
    public var id: String
    public var kind: ProviderKind
    public var displayName: String
    public var baseUrl: String?
    public var createdAt: String
    public var lastValidatedAt: String?
    public var accountLabel: String?
    public var enabled: Bool
    /// True when models come from the hand-written catalog, not the endpoint.
    public var hasModelCatalog: Bool

    public init(
        id: String = "",
        kind: ProviderKind = ProviderKind(rawValue: 0),
        displayName: String = "",
        baseUrl: String? = nil,
        createdAt: String = "",
        lastValidatedAt: String? = nil,
        accountLabel: String? = nil,
        enabled: Bool = false,
        hasModelCatalog: Bool = false
    ) {
        self.id = id
        self.kind = kind
        self.displayName = displayName
        self.baseUrl = baseUrl
        self.createdAt = createdAt
        self.lastValidatedAt = lastValidatedAt
        self.accountLabel = accountLabel
        self.enabled = enabled
        self.hasModelCatalog = hasModelCatalog
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        kind = c.lenient(.kind) ?? ProviderKind(rawValue: 0)
        displayName = c.lenient(.displayName) ?? ""
        baseUrl = c.lenient(.baseUrl)
        createdAt = c.lenient(.createdAt) ?? ""
        lastValidatedAt = c.lenient(.lastValidatedAt)
        accountLabel = c.lenient(.accountLabel)
        enabled = c.lenient(.enabled) ?? false
        hasModelCatalog = c.lenient(.hasModelCatalog) ?? false
    }
}

public struct CreateConnectionRequest: Codable, Hashable, Sendable {
    public var kind: ProviderKind
    public var displayName: String
    public var apiKey: String
    public var baseUrl: String?
    /// For OpenAI-compatible endpoints that don't implement `GET /models`: the
    /// catalog (the Codex `models.json` shape) pasted from the provider's docs.
    /// The connection lists from it instead of asking the endpoint.
    public var modelCatalogJson: String?

    public init(
        kind: ProviderKind = ProviderKind(rawValue: 0),
        displayName: String = "",
        apiKey: String = "",
        baseUrl: String? = nil,
        modelCatalogJson: String? = nil
    ) {
        self.kind = kind
        self.displayName = displayName
        self.apiKey = apiKey
        self.baseUrl = baseUrl
        self.modelCatalogJson = modelCatalogJson
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.lenient(.kind) ?? ProviderKind(rawValue: 0)
        displayName = c.lenient(.displayName) ?? ""
        apiKey = c.lenient(.apiKey) ?? ""
        baseUrl = c.lenient(.baseUrl)
        modelCatalogJson = c.lenient(.modelCatalogJson)
    }
}

public struct ModelOption: Codable, Hashable, Sendable {
    public var id: String
    public var displayName: String
    public var contextWindowTokens: Int?
    public var defaultThinkingLevel: ThinkingLevel?
    public var supportedThinkingLevels: [ThinkingLevel]?
    public var alwaysThinks: Bool?

    public init(
        id: String = "",
        displayName: String = "",
        contextWindowTokens: Int? = nil,
        defaultThinkingLevel: ThinkingLevel? = nil,
        supportedThinkingLevels: [ThinkingLevel]? = nil,
        alwaysThinks: Bool? = nil
    ) {
        self.id = id
        self.displayName = displayName
        self.contextWindowTokens = contextWindowTokens
        self.defaultThinkingLevel = defaultThinkingLevel
        self.supportedThinkingLevels = supportedThinkingLevels
        self.alwaysThinks = alwaysThinks
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        displayName = c.lenient(.displayName) ?? ""
        contextWindowTokens = c.lenient(.contextWindowTokens)
        defaultThinkingLevel = c.lenient(.defaultThinkingLevel)
        supportedThinkingLevels = c.lenient(.supportedThinkingLevels)
        alwaysThinks = c.lenient(.alwaysThinks)
    }
}

public struct GitConnectionSummary: Codable, Hashable, Sendable {
    public var id: String
    public var kind: GitServiceKind
    public var displayName: String
    public var baseUrl: String?
    public var username: String
    public var createdAt: String
    public var lastValidatedAt: String?
    /// What is wrong with this connection and what fixes it, or null while it is
    /// healthy. Written by the server (`GitConnectionHealth`) so every client says
    /// the same thing — and because both failures it covers are otherwise
    /// invisible: an expired sign-in shows up only as a repository picker with
    /// nothing in it, and a GitHub token without the `workflow` scope only as a
    /// push the agent cannot land.
    public var trouble: String?

    public init(
        id: String = "",
        kind: GitServiceKind = GitServiceKind(rawValue: 0),
        displayName: String = "",
        baseUrl: String? = nil,
        username: String = "",
        createdAt: String = "",
        lastValidatedAt: String? = nil,
        trouble: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.displayName = displayName
        self.baseUrl = baseUrl
        self.username = username
        self.createdAt = createdAt
        self.lastValidatedAt = lastValidatedAt
        self.trouble = trouble
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        kind = c.lenient(.kind) ?? GitServiceKind(rawValue: 0)
        displayName = c.lenient(.displayName) ?? ""
        baseUrl = c.lenient(.baseUrl)
        username = c.lenient(.username) ?? ""
        createdAt = c.lenient(.createdAt) ?? ""
        lastValidatedAt = c.lenient(.lastValidatedAt)
        trouble = c.lenient(.trouble)
    }
}

public struct GitAppSummary: Codable, Hashable, Sendable {
    public var id: String
    public var kind: GitServiceKind
    public var baseUrl: String?
    public var clientId: String
    public var createdAt: String

    public init(
        id: String = "",
        kind: GitServiceKind = GitServiceKind(rawValue: 0),
        baseUrl: String? = nil,
        clientId: String = "",
        createdAt: String = ""
    ) {
        self.id = id
        self.kind = kind
        self.baseUrl = baseUrl
        self.clientId = clientId
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        kind = c.lenient(.kind) ?? GitServiceKind(rawValue: 0)
        baseUrl = c.lenient(.baseUrl)
        clientId = c.lenient(.clientId) ?? ""
        createdAt = c.lenient(.createdAt) ?? ""
    }
}

/// The device flow's handles. Neither value is a bearer token; `interval` is a .NET TimeSpan string.
public struct CodexDeviceStart: Codable, Hashable, Sendable {
    public var deviceAuthId: String?
    public var userCode: String?
    public var interval: String
    public var verificationUrl: String
    public var error: String?

    public init(
        deviceAuthId: String? = nil,
        userCode: String? = nil,
        interval: String = "",
        verificationUrl: String = "",
        error: String? = nil
    ) {
        self.deviceAuthId = deviceAuthId
        self.userCode = userCode
        self.interval = interval
        self.verificationUrl = verificationUrl
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deviceAuthId = c.lenient(.deviceAuthId)
        userCode = c.lenient(.userCode)
        interval = c.lenient(.interval) ?? ""
        verificationUrl = c.lenient(.verificationUrl) ?? ""
        error = c.lenient(.error)
    }
}

public struct CodexPollStatus: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let pending = CodexPollStatus(rawValue: 0)
    public static let connected = CodexPollStatus(rawValue: 1)
    public static let failed = CodexPollStatus(rawValue: 2)

    public static let allKnown: [CodexPollStatus] = [.pending, .connected, .failed]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Pending"
        case 1: return "Connected"
        case 2: return "Failed"
        default: return nil
        }
    }
}

public struct CodexPollResult: Codable, Hashable, Sendable {
    public var status: CodexPollStatus
    public var error: String?

    public init(
        status: CodexPollStatus = CodexPollStatus(rawValue: 0),
        error: String? = nil
    ) {
        self.status = status
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = c.lenient(.status) ?? CodexPollStatus(rawValue: 0)
        error = c.lenient(.error)
    }
}

public struct McpTransportKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let stdio = McpTransportKind(rawValue: 0)
    public static let http = McpTransportKind(rawValue: 1)

    public static let allKnown: [McpTransportKind] = [.stdio, .http]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Stdio"
        case 1: return "Http"
        default: return nil
        }
    }
}

public struct McpServerSummary: Codable, Hashable, Sendable {
    public var id: String
    public var displayName: String
    public var kind: McpTransportKind
    public var command: String
    public var args: [String]
    public var url: String?
    public var hasSecrets: Bool
    public var enabled: Bool
    public var createdAt: String

    public init(
        id: String = "",
        displayName: String = "",
        kind: McpTransportKind = McpTransportKind(rawValue: 0),
        command: String = "",
        args: [String] = [],
        url: String? = nil,
        hasSecrets: Bool = false,
        enabled: Bool = false,
        createdAt: String = ""
    ) {
        self.id = id
        self.displayName = displayName
        self.kind = kind
        self.command = command
        self.args = args
        self.url = url
        self.hasSecrets = hasSecrets
        self.enabled = enabled
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        displayName = c.lenient(.displayName) ?? ""
        kind = c.lenient(.kind) ?? McpTransportKind(rawValue: 0)
        command = c.lenient(.command) ?? ""
        args = c.lenient(.args) ?? []
        url = c.lenient(.url)
        hasSecrets = c.lenient(.hasSecrets) ?? false
        enabled = c.lenient(.enabled) ?? false
        createdAt = c.lenient(.createdAt) ?? ""
    }
}

/// `secrets` null on an update keeps the stored cipher; a map replaces it.
public struct McpServerRequest: Codable, Hashable, Sendable {
    public var displayName: String
    public var kind: McpTransportKind
    public var command: String
    public var args: [String]
    public var url: String?
    public var secrets: [String: String]?

    public init(
        displayName: String = "",
        kind: McpTransportKind = McpTransportKind(rawValue: 0),
        command: String = "",
        args: [String] = [],
        url: String? = nil,
        secrets: [String: String]? = nil
    ) {
        self.displayName = displayName
        self.kind = kind
        self.command = command
        self.args = args
        self.url = url
        self.secrets = secrets
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        displayName = c.lenient(.displayName) ?? ""
        kind = c.lenient(.kind) ?? McpTransportKind(rawValue: 0)
        command = c.lenient(.command) ?? ""
        args = c.lenient(.args) ?? []
        url = c.lenient(.url)
        secrets = c.lenient(.secrets)
    }
}

public struct TerminalPrefs: Codable, Hashable, Sendable {
    public var packages: String?
    public var shell: String?

    public init(
        packages: String? = nil,
        shell: String? = nil
    ) {
        self.packages = packages
        self.shell = shell
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        packages = c.lenient(.packages)
        shell = c.lenient(.shell)
    }
}

public struct TerminalDefaults: Codable, Hashable, Sendable {
    public var packages: String
    public var shell: String

    public init(
        packages: String = "",
        shell: String = ""
    ) {
        self.packages = packages
        self.shell = shell
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        packages = c.lenient(.packages) ?? ""
        shell = c.lenient(.shell) ?? ""
    }
}

public struct UserFacetSummary: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var content: String
    public var updatedAt: String

    public init(
        id: String = "",
        name: String = "",
        content: String = "",
        updatedAt: String = ""
    ) {
        self.id = id
        self.name = name
        self.content = content
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        name = c.lenient(.name) ?? ""
        content = c.lenient(.content) ?? ""
        updatedAt = c.lenient(.updatedAt) ?? ""
    }
}

public struct FacetCheck: Codable, Hashable, Sendable {
    public var name: String?
    public var toolsAllowed: Int
    public var toolsDenied: Int
    public var model: String?
    public var error: String?

    public init(
        name: String? = nil,
        toolsAllowed: Int = 0,
        toolsDenied: Int = 0,
        model: String? = nil,
        error: String? = nil
    ) {
        self.name = name
        self.toolsAllowed = toolsAllowed
        self.toolsDenied = toolsDenied
        self.model = model
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lenient(.name)
        toolsAllowed = c.lenient(.toolsAllowed) ?? 0
        toolsDenied = c.lenient(.toolsDenied) ?? 0
        model = c.lenient(.model)
        error = c.lenient(.error)
    }
}

public struct PermissionsCheck: Codable, Hashable, Sendable {
    public var ruleCount: Int
    public var error: String?

    public init(
        ruleCount: Int = 0,
        error: String? = nil
    ) {
        self.ruleCount = ruleCount
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ruleCount = c.lenient(.ruleCount) ?? 0
        error = c.lenient(.error)
    }
}

/// The shapes an artifact's body can take. Mirrors
/// `SlopCoder.Contracts.ArtifactFormats`; a string on both sides on purpose, so
/// neither end can renumber the other into rendering a report as a spreadsheet.
public struct ArtifactFormat: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let markdown = ArtifactFormat(rawValue: "markdown")
    public static let text = ArtifactFormat(rawValue: "text")
    public static let html = ArtifactFormat(rawValue: "html")
    public static let json = ArtifactFormat(rawValue: "json")
    public static let csv = ArtifactFormat(rawValue: "csv")
    public static let binary = ArtifactFormat(rawValue: "binary")
}

/// A published artifact, without its body.
public struct ArtifactSummary: Codable, Hashable, Sendable {
    public var id: String
    public var slug: String
    public var title: String
    public var format: ArtifactFormat
    public var contentType: String
    public var description: String
    /// The opening of the body, for a card that shows the artifact rather than
    /// describing it. Empty for a binary one — there is nothing to read, and the
    /// card draws the format instead. Markdown arrives as markdown, with any
    /// fence the cut left open closed again; HTML arrives as its words.
    public var preview: String
    /// The body's size in bytes, text measured as UTF-8.
    public var size: Int
    /// Bumped each time the agent republishes this slug.
    public var version: Int
    public var sessionId: String?
    public var sessionTitle: String?
    public var routineId: String?
    public var routineName: String?
    /// The unlisted link's token, or null while the artifact is private.
    public var shareToken: String?
    public var createdAt: String
    public var updatedAt: String
    /// Computed server-side from shareToken; sent, not derived, so both agree.
    public var shared: Bool
    /// App-relative `a/<token>` while shared, else null.
    public var sharePath: String?
    public var hasApp: Bool?
    public var appConfig: String?

    public init(
        id: String = "",
        slug: String = "",
        title: String = "",
        format: ArtifactFormat = ArtifactFormat(rawValue: ""),
        contentType: String = "",
        description: String = "",
        preview: String = "",
        size: Int = 0,
        version: Int = 0,
        sessionId: String? = nil,
        sessionTitle: String? = nil,
        routineId: String? = nil,
        routineName: String? = nil,
        shareToken: String? = nil,
        createdAt: String = "",
        updatedAt: String = "",
        shared: Bool = false,
        sharePath: String? = nil,
        hasApp: Bool? = nil,
        appConfig: String? = nil
    ) {
        self.id = id
        self.slug = slug
        self.title = title
        self.format = format
        self.contentType = contentType
        self.description = description
        self.preview = preview
        self.size = size
        self.version = version
        self.sessionId = sessionId
        self.sessionTitle = sessionTitle
        self.routineId = routineId
        self.routineName = routineName
        self.shareToken = shareToken
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.shared = shared
        self.sharePath = sharePath
        self.hasApp = hasApp
        self.appConfig = appConfig
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        slug = c.lenient(.slug) ?? ""
        title = c.lenient(.title) ?? ""
        format = c.lenient(.format) ?? ArtifactFormat(rawValue: "")
        contentType = c.lenient(.contentType) ?? ""
        description = c.lenient(.description) ?? ""
        preview = c.lenient(.preview) ?? ""
        size = c.lenient(.size) ?? 0
        version = c.lenient(.version) ?? 0
        sessionId = c.lenient(.sessionId)
        sessionTitle = c.lenient(.sessionTitle)
        routineId = c.lenient(.routineId)
        routineName = c.lenient(.routineName)
        shareToken = c.lenient(.shareToken)
        createdAt = c.lenient(.createdAt) ?? ""
        updatedAt = c.lenient(.updatedAt) ?? ""
        shared = c.lenient(.shared) ?? false
        sharePath = c.lenient(.sharePath)
        hasApp = c.lenient(.hasApp)
        appConfig = c.lenient(.appConfig)
    }
}

public struct ArtifactAppStatus: Codable, Hashable, Sendable {
    public var state: String
    public var repo: String?
    public var port: Int?
    public var error: String?
    public var landingPath: String
    public var previewUrl: String
    public var sandbox: String

    public init(
        state: String = "",
        repo: String? = nil,
        port: Int? = nil,
        error: String? = nil,
        landingPath: String = "",
        previewUrl: String = "",
        sandbox: String = ""
    ) {
        self.state = state
        self.repo = repo
        self.port = port
        self.error = error
        self.landingPath = landingPath
        self.previewUrl = previewUrl
        self.sandbox = sandbox
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = c.lenient(.state) ?? ""
        repo = c.lenient(.repo)
        port = c.lenient(.port)
        error = c.lenient(.error)
        landingPath = c.lenient(.landingPath) ?? ""
        previewUrl = c.lenient(.previewUrl) ?? ""
        sandbox = c.lenient(.sandbox) ?? ""
    }
}

/// One artifact with its body — null for a binary one, which is fetched raw.
public struct ArtifactDetail: Codable, Hashable, Sendable {
    public var artifact: ArtifactSummary
    public var text: String?

    public init(
        artifact: ArtifactSummary = ArtifactSummary(),
        text: String? = nil
    ) {
        self.artifact = artifact
        self.text = text
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        artifact = c.lenient(.artifact) ?? ArtifactSummary()
        text = c.lenient(.text)
    }
}

/// One kept edition of an artifact (`ArtifactVersionSummary`).
public struct ArtifactVersionSummary: Codable, Hashable, Sendable {
    public var version: Int
    public var publishedAt: String
    public var title: String
    public var format: ArtifactFormat
    public var contentType: String
    public var size: Int
    public var sessionId: String?
    public var sessionTitle: String?
    public var routineId: String?
    public var routineName: String?
    public var isLatest: Bool
    public var shareToken: String?

    public init(
        version: Int = 0,
        publishedAt: String = "",
        title: String = "",
        format: ArtifactFormat = ArtifactFormat(rawValue: ""),
        contentType: String = "",
        size: Int = 0,
        sessionId: String? = nil,
        sessionTitle: String? = nil,
        routineId: String? = nil,
        routineName: String? = nil,
        isLatest: Bool = false,
        shareToken: String? = nil
    ) {
        self.version = version
        self.publishedAt = publishedAt
        self.title = title
        self.format = format
        self.contentType = contentType
        self.size = size
        self.sessionId = sessionId
        self.sessionTitle = sessionTitle
        self.routineId = routineId
        self.routineName = routineName
        self.isLatest = isLatest
        self.shareToken = shareToken
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.lenient(.version) ?? 0
        publishedAt = c.lenient(.publishedAt) ?? ""
        title = c.lenient(.title) ?? ""
        format = c.lenient(.format) ?? ArtifactFormat(rawValue: "")
        contentType = c.lenient(.contentType) ?? ""
        size = c.lenient(.size) ?? 0
        sessionId = c.lenient(.sessionId)
        sessionTitle = c.lenient(.sessionTitle)
        routineId = c.lenient(.routineId)
        routineName = c.lenient(.routineName)
        isLatest = c.lenient(.isLatest) ?? false
        shareToken = c.lenient(.shareToken)
    }
}

/// One edition with its body when text; binary bodies are at `/artifacts/{id}/versions/{n}/raw`.
public struct ArtifactVersionDetail: Codable, Hashable, Sendable {
    public var version: ArtifactVersionSummary
    public var description: String
    public var text: String?

    public init(
        version: ArtifactVersionSummary = ArtifactVersionSummary(),
        description: String = "",
        text: String? = nil
    ) {
        self.version = version
        self.description = description
        self.text = text
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.lenient(.version) ?? ArtifactVersionSummary()
        description = c.lenient(.description) ?? ""
        text = c.lenient(.text)
    }
}

public struct MemorySummary: Codable, Hashable, Sendable {
    public var id: String
    public var repoKey: String
    public var name: String
    public var description: String
    public var content: String
    public var pinned: Bool
    public var updatedAt: String

    public init(
        id: String = "",
        repoKey: String = "",
        name: String = "",
        description: String = "",
        content: String = "",
        pinned: Bool = false,
        updatedAt: String = ""
    ) {
        self.id = id
        self.repoKey = repoKey
        self.name = name
        self.description = description
        self.content = content
        self.pinned = pinned
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        repoKey = c.lenient(.repoKey) ?? ""
        name = c.lenient(.name) ?? ""
        description = c.lenient(.description) ?? ""
        content = c.lenient(.content) ?? ""
        pinned = c.lenient(.pinned) ?? false
        updatedAt = c.lenient(.updatedAt) ?? ""
    }
}

public struct SaveMemoryRequest: Codable, Hashable, Sendable {
    public var repoKey: String
    public var name: String
    public var description: String
    public var content: String
    public var pinned: Bool

    public init(
        repoKey: String = "",
        name: String = "",
        description: String = "",
        content: String = "",
        pinned: Bool = false
    ) {
        self.repoKey = repoKey
        self.name = name
        self.description = description
        self.content = content
        self.pinned = pinned
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        repoKey = c.lenient(.repoKey) ?? ""
        name = c.lenient(.name) ?? ""
        description = c.lenient(.description) ?? ""
        content = c.lenient(.content) ?? ""
        pinned = c.lenient(.pinned) ?? false
    }
}

public struct UserSkillSummary: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var content: String
    public var updatedAt: String

    public init(
        id: String = "",
        name: String = "",
        content: String = "",
        updatedAt: String = ""
    ) {
        self.id = id
        self.name = name
        self.content = content
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        name = c.lenient(.name) ?? ""
        content = c.lenient(.content) ?? ""
        updatedAt = c.lenient(.updatedAt) ?? ""
    }
}

/// The non-secret half of a channel. `settings` is the JSON blob the kind reads.
public struct ChannelDraft: Codable, Hashable, Sendable {
    public var kind: ChannelKind
    public var displayName: String
    public var secret: String?
    public var settings: String
    public var enabled: Bool

    public init(
        kind: ChannelKind = ChannelKind(rawValue: 0),
        displayName: String = "",
        secret: String? = nil,
        settings: String = "",
        enabled: Bool = false
    ) {
        self.kind = kind
        self.displayName = displayName
        self.secret = secret
        self.settings = settings
        self.enabled = enabled
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.lenient(.kind) ?? ChannelKind(rawValue: 0)
        displayName = c.lenient(.displayName) ?? ""
        secret = c.lenient(.secret)
        settings = c.lenient(.settings) ?? ""
        enabled = c.lenient(.enabled) ?? false
    }
}

public struct ApiKeySummary: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var prefix: String
    public var createdAt: String
    public var lastUsedAt: String?

    public init(
        id: String = "",
        name: String = "",
        prefix: String = "",
        createdAt: String = "",
        lastUsedAt: String? = nil
    ) {
        self.id = id
        self.name = name
        self.prefix = prefix
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        name = c.lenient(.name) ?? ""
        prefix = c.lenient(.prefix) ?? ""
        createdAt = c.lenient(.createdAt) ?? ""
        lastUsedAt = c.lenient(.lastUsedAt)
    }
}

/// `fullKey` is in this response and nowhere else, ever again.
public struct MintedApiKey: Codable, Hashable, Sendable {
    public var key: ApiKeySummary
    public var fullKey: String

    public init(
        key: ApiKeySummary = ApiKeySummary(),
        fullKey: String = ""
    ) {
        self.key = key
        self.fullKey = fullKey
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = c.lenient(.key) ?? ApiKeySummary()
        fullKey = c.lenient(.fullKey) ?? ""
    }
}

public struct DevicePairingCode: Codable, Hashable, Sendable {
    public var code: String
    public var expiresAt: String

    public init(
        code: String = "",
        expiresAt: String = ""
    ) {
        self.code = code
        self.expiresAt = expiresAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = c.lenient(.code) ?? ""
        expiresAt = c.lenient(.expiresAt) ?? ""
    }
}

/// A slash command's name and one-line help, for the composer's menu.
public struct SlashCommandInfo: Codable, Hashable, Sendable {
    public var name: String
    public var help: String

    public init(
        name: String = "",
        help: String = ""
    ) {
        self.name = name
        self.help = help
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lenient(.name) ?? ""
        help = c.lenient(.help) ?? ""
    }
}

/// What running a slash command produced. A null `promptToSend` means the
/// command handled itself — it appended to the scrollback and there is nothing
/// to send; a string is an expanded template to submit as an ordinary prompt.
public struct SlashResult: Codable, Hashable, Sendable {
    public var promptToSend: String?

    public init(
        promptToSend: String? = nil
    ) {
        self.promptToSend = promptToSend
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        promptToSend = c.lenient(.promptToSend)
    }
}

// ---- code reviews ----
//
// Ported from src/SlopCoder.Contracts (ICodeReviewsApi and the records it
// carries): numeric enums, camelCase fields, the exact wire shapes the server
// sends. Only what the review screens read — enqueue stays an agent tool, and
// the publication records arrive with slice 3.

public struct CodeReviewTargetKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let pullRequest = CodeReviewTargetKind(rawValue: 0)
    public static let commitRange = CodeReviewTargetKind(rawValue: 1)
    public static let workingChanges = CodeReviewTargetKind(rawValue: 2)
    public static let snapshot = CodeReviewTargetKind(rawValue: 3)

    public static let allKnown: [CodeReviewTargetKind] = [.pullRequest, .commitRange, .workingChanges, .snapshot]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "PullRequest"
        case 1: return "CommitRange"
        case 2: return "WorkingChanges"
        case 3: return "Snapshot"
        default: return nil
        }
    }
}

public struct CodeReviewSourceKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let forge = CodeReviewSourceKind(rawValue: 0)
    public static let sessionBundle = CodeReviewSourceKind(rawValue: 1)

    public static let allKnown: [CodeReviewSourceKind] = [.forge, .sessionBundle]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Forge"
        case 1: return "SessionBundle"
        default: return nil
        }
    }
}

/// An agent review and a pipeline review of the same head are different reviews.
public struct CodeReviewMode: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let pipeline = CodeReviewMode(rawValue: 0)
    public static let agent = CodeReviewMode(rawValue: 1)

    public static let allKnown: [CodeReviewMode] = [.pipeline, .agent]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Pipeline"
        case 1: return "Agent"
        default: return nil
        }
    }
}

public struct CodeReviewAnalysisState: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let queued = CodeReviewAnalysisState(rawValue: 0)
    public static let snapshotting = CodeReviewAnalysisState(rawValue: 1)
    public static let captured = CodeReviewAnalysisState(rawValue: 2)
    public static let failed = CodeReviewAnalysisState(rawValue: 3)
    public static let superseded = CodeReviewAnalysisState(rawValue: 4)
    public static let planning = CodeReviewAnalysisState(rawValue: 5)
    public static let investigating = CodeReviewAnalysisState(rawValue: 6)
    public static let cancelled = CodeReviewAnalysisState(rawValue: 7)
    public static let validating = CodeReviewAnalysisState(rawValue: 8)
    public static let falsifying = CodeReviewAnalysisState(rawValue: 9)
    public static let completed = CodeReviewAnalysisState(rawValue: 10)
    public static let partial = CodeReviewAnalysisState(rawValue: 11)
    public static let consolidating = CodeReviewAnalysisState(rawValue: 12)

    public static let allKnown: [CodeReviewAnalysisState] = [.queued, .snapshotting, .captured, .failed, .superseded, .planning, .investigating, .cancelled, .validating, .falsifying, .completed, .partial, .consolidating]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Queued"
        case 1: return "Snapshotting"
        case 2: return "Captured"
        case 3: return "Failed"
        case 4: return "Superseded"
        case 5: return "Planning"
        case 6: return "Investigating"
        case 7: return "Cancelled"
        case 8: return "Validating"
        case 9: return "Falsifying"
        case 10: return "Completed"
        case 11: return "Partial"
        case 12: return "Consolidating"
        default: return nil
        }
    }
}

public struct CodeReviewSeverity: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let p0 = CodeReviewSeverity(rawValue: 0)
    public static let p1 = CodeReviewSeverity(rawValue: 1)
    public static let p2 = CodeReviewSeverity(rawValue: 2)
    public static let p3 = CodeReviewSeverity(rawValue: 3)

    public static let allKnown: [CodeReviewSeverity] = [.p0, .p1, .p2, .p3]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "P0"
        case 1: return "P1"
        case 2: return "P2"
        case 3: return "P3"
        default: return nil
        }
    }
}

public struct CodeReviewCategory: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let correctness = CodeReviewCategory(rawValue: 0)
    public static let compatibility = CodeReviewCategory(rawValue: 1)
    public static let concurrency = CodeReviewCategory(rawValue: 2)
    public static let resourceLifecycle = CodeReviewCategory(rawValue: 3)
    public static let security = CodeReviewCategory(rawValue: 4)
    public static let tests = CodeReviewCategory(rawValue: 5)
    public static let repositoryRules = CodeReviewCategory(rawValue: 6)
    public static let maintainability = CodeReviewCategory(rawValue: 7)

    public static let allKnown: [CodeReviewCategory] = [.correctness, .compatibility, .concurrency, .resourceLifecycle, .security, .tests, .repositoryRules, .maintainability]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Correctness"
        case 1: return "Compatibility"
        case 2: return "Concurrency"
        case 3: return "ResourceLifecycle"
        case 4: return "Security"
        case 5: return "Tests"
        case 6: return "RepositoryRules"
        case 7: return "Maintainability"
        default: return nil
        }
    }
}

public struct CodeReviewAnchorSide: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let head = CodeReviewAnchorSide(rawValue: 0)
    public static let base = CodeReviewAnchorSide(rawValue: 1)

    public static let allKnown: [CodeReviewAnchorSide] = [.head, .base]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Head"
        case 1: return "Base"
        default: return nil
        }
    }
}

public struct CodeReviewManifestDisposition: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let pendingReview = CodeReviewManifestDisposition(rawValue: 0)
    public static let generatedOrVendorExclusion = CodeReviewManifestDisposition(rawValue: 1)
    public static let binaryExclusion = CodeReviewManifestDisposition(rawValue: 2)
    public static let policyExclusion = CodeReviewManifestDisposition(rawValue: 3)
    public static let unsupportedContent = CodeReviewManifestDisposition(rawValue: 4)
    public static let tooLarge = CodeReviewManifestDisposition(rawValue: 5)
    public static let unavailable = CodeReviewManifestDisposition(rawValue: 6)

    public static let allKnown: [CodeReviewManifestDisposition] = [.pendingReview, .generatedOrVendorExclusion, .binaryExclusion, .policyExclusion, .unsupportedContent, .tooLarge, .unavailable]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "PendingReview"
        case 1: return "GeneratedOrVendorExclusion"
        case 2: return "BinaryExclusion"
        case 3: return "PolicyExclusion"
        case 4: return "UnsupportedContent"
        case 5: return "TooLarge"
        case 6: return "Unavailable"
        default: return nil
        }
    }
}

public struct CodeReviewCaptureCompleteness: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let complete = CodeReviewCaptureCompleteness(rawValue: 0)
    public static let completeWithExclusions = CodeReviewCaptureCompleteness(rawValue: 1)
    public static let incomplete = CodeReviewCaptureCompleteness(rawValue: 2)

    public static let allKnown: [CodeReviewCaptureCompleteness] = [.complete, .completeWithExclusions, .incomplete]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Complete"
        case 1: return "CompleteWithExclusions"
        case 2: return "Incomplete"
        default: return nil
        }
    }
}

public struct CodeReviewCompleteness: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let pending = CodeReviewCompleteness(rawValue: 0)
    public static let complete = CodeReviewCompleteness(rawValue: 1)
    public static let completeWithExclusions = CodeReviewCompleteness(rawValue: 2)
    public static let partial = CodeReviewCompleteness(rawValue: 3)
    public static let stale = CodeReviewCompleteness(rawValue: 4)
    public static let notAssessed = CodeReviewCompleteness(rawValue: 5)

    public static let allKnown: [CodeReviewCompleteness] = [.pending, .complete, .completeWithExclusions, .partial, .stale, .notAssessed]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Pending"
        case 1: return "Complete"
        case 2: return "CompleteWithExclusions"
        case 3: return "Partial"
        case 4: return "Stale"
        case 5: return "NotAssessed"
        default: return nil
        }
    }
}

public struct CodeReviewCaptureIncompleteReason: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let none = CodeReviewCaptureIncompleteReason(rawValue: 0)
    public static let paginationLimitReached = CodeReviewCaptureIncompleteReason(rawValue: 1)
    public static let sourceUnavailable = CodeReviewCaptureIncompleteReason(rawValue: 2)
    public static let sourceMalformed = CodeReviewCaptureIncompleteReason(rawValue: 3)
    public static let responseTooLarge = CodeReviewCaptureIncompleteReason(rawValue: 4)
    public static let fileCountMismatch = CodeReviewCaptureIncompleteReason(rawValue: 5)
    public static let snapshotLimitReached = CodeReviewCaptureIncompleteReason(rawValue: 6)

    public static let allKnown: [CodeReviewCaptureIncompleteReason] = [.none, .paginationLimitReached, .sourceUnavailable, .sourceMalformed, .responseTooLarge, .fileCountMismatch, .snapshotLimitReached]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "None"
        case 1: return "PaginationLimitReached"
        case 2: return "SourceUnavailable"
        case 3: return "SourceMalformed"
        case 4: return "ResponseTooLarge"
        case 5: return "FileCountMismatch"
        case 6: return "SnapshotLimitReached"
        default: return nil
        }
    }
}

public struct CodeReviewPlanPartialReason: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let workItemCap = CodeReviewPlanPartialReason(rawValue: 0)
    public static let captureIncomplete = CodeReviewPlanPartialReason(rawValue: 1)
    public static let contentUnavailable = CodeReviewPlanPartialReason(rawValue: 2)

    public static let allKnown: [CodeReviewPlanPartialReason] = [.workItemCap, .captureIncomplete, .contentUnavailable]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "WorkItemCap"
        case 1: return "CaptureIncomplete"
        case 2: return "ContentUnavailable"
        default: return nil
        }
    }
}

public struct CodeReviewWorkKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let generator = CodeReviewWorkKind(rawValue: 0)
    public static let verifier = CodeReviewWorkKind(rawValue: 1)

    public static let allKnown: [CodeReviewWorkKind] = [.generator, .verifier]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Generator"
        case 1: return "Verifier"
        default: return nil
        }
    }
}

public struct CodeReviewWorkItemOutcome: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let pending = CodeReviewWorkItemOutcome(rawValue: 0)
    public static let running = CodeReviewWorkItemOutcome(rawValue: 1)
    public static let completed = CodeReviewWorkItemOutcome(rawValue: 2)
    public static let failed = CodeReviewWorkItemOutcome(rawValue: 3)
    public static let cancelled = CodeReviewWorkItemOutcome(rawValue: 4)
    public static let deferred = CodeReviewWorkItemOutcome(rawValue: 5)

    public static let allKnown: [CodeReviewWorkItemOutcome] = [.pending, .running, .completed, .failed, .cancelled, .deferred]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Pending"
        case 1: return "Running"
        case 2: return "Completed"
        case 3: return "Failed"
        case 4: return "Cancelled"
        case 5: return "Deferred"
        default: return nil
        }
    }
}

public struct CodeReviewLens: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let localCorrectness = CodeReviewLens(rawValue: 0)
    public static let compatibility = CodeReviewLens(rawValue: 1)
    public static let concurrencyAndLifecycle = CodeReviewLens(rawValue: 2)
    public static let security = CodeReviewLens(rawValue: 3)
    public static let testsAndCoverage = CodeReviewLens(rawValue: 4)
    public static let repositoryRules = CodeReviewLens(rawValue: 5)

    public static let allKnown: [CodeReviewLens] = [.localCorrectness, .compatibility, .concurrencyAndLifecycle, .security, .testsAndCoverage, .repositoryRules]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "LocalCorrectness"
        case 1: return "Compatibility"
        case 2: return "ConcurrencyAndLifecycle"
        case 3: return "Security"
        case 4: return "TestsAndCoverage"
        case 5: return "RepositoryRules"
        default: return nil
        }
    }
}

public struct CodeReviewFailureClass: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let transientNetwork = CodeReviewFailureClass(rawValue: 0)
    public static let rateLimited = CodeReviewFailureClass(rawValue: 1)
    public static let leaseExpired = CodeReviewFailureClass(rawValue: 2)
    public static let processInterrupted = CodeReviewFailureClass(rawValue: 3)
    public static let schemaViolation = CodeReviewFailureClass(rawValue: 4)
    public static let invalidAnchor = CodeReviewFailureClass(rawValue: 5)
    public static let authorization = CodeReviewFailureClass(rawValue: 6)
    public static let unsafePath = CodeReviewFailureClass(rawValue: 7)
    public static let deterministicIncompatibility = CodeReviewFailureClass(rawValue: 8)
    public static let budgetExhausted = CodeReviewFailureClass(rawValue: 9)
    public static let modelUnavailable = CodeReviewFailureClass(rawValue: 10)

    public static let allKnown: [CodeReviewFailureClass] = [.transientNetwork, .rateLimited, .leaseExpired, .processInterrupted, .schemaViolation, .invalidAnchor, .authorization, .unsafePath, .deterministicIncompatibility, .budgetExhausted, .modelUnavailable]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "TransientNetwork"
        case 1: return "RateLimited"
        case 2: return "LeaseExpired"
        case 3: return "ProcessInterrupted"
        case 4: return "SchemaViolation"
        case 5: return "InvalidAnchor"
        case 6: return "Authorization"
        case 7: return "UnsafePath"
        case 8: return "DeterministicIncompatibility"
        case 9: return "BudgetExhausted"
        case 10: return "ModelUnavailable"
        default: return nil
        }
    }
}

public struct CodeReviewFindingDisposition: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let open = CodeReviewFindingDisposition(rawValue: 0)
    public static let accepted = CodeReviewFindingDisposition(rawValue: 1)
    public static let dismissed = CodeReviewFindingDisposition(rawValue: 2)

    public static let allKnown: [CodeReviewFindingDisposition] = [.open, .accepted, .dismissed]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Open"
        case 1: return "Accepted"
        case 2: return "Dismissed"
        default: return nil
        }
    }
}

public struct CodeReviewFindingSource: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let candidate = CodeReviewFindingSource(rawValue: 0)
    public static let verifierCorrection = CodeReviewFindingSource(rawValue: 1)

    public static let allKnown: [CodeReviewFindingSource] = [.candidate, .verifierCorrection]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Candidate"
        case 1: return "VerifierCorrection"
        default: return nil
        }
    }
}

public struct CodeReviewFindingProvenance: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let pipeline = CodeReviewFindingProvenance(rawValue: 0)
    public static let agentSession = CodeReviewFindingProvenance(rawValue: 1)

    public static let allKnown: [CodeReviewFindingProvenance] = [.pipeline, .agentSession]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Pipeline"
        case 1: return "AgentSession"
        default: return nil
        }
    }
}

public struct CodeReviewFindingUpdateStatus: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let updated = CodeReviewFindingUpdateStatus(rawValue: 0)
    public static let unchanged = CodeReviewFindingUpdateStatus(rawValue: 1)
    public static let versionConflict = CodeReviewFindingUpdateStatus(rawValue: 2)
    public static let consolidationChanged = CodeReviewFindingUpdateStatus(rawValue: 3)
    public static let superseded = CodeReviewFindingUpdateStatus(rawValue: 4)
    public static let invalid = CodeReviewFindingUpdateStatus(rawValue: 5)

    public static let allKnown: [CodeReviewFindingUpdateStatus] = [.updated, .unchanged, .versionConflict, .consolidationChanged, .superseded, .invalid]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Updated"
        case 1: return "Unchanged"
        case 2: return "VersionConflict"
        case 3: return "ConsolidationChanged"
        case 4: return "Superseded"
        case 5: return "Invalid"
        default: return nil
        }
    }
}

public struct CodeReviewElevationTarget: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let pullRequestReview = CodeReviewElevationTarget(rawValue: 0)
    public static let issues = CodeReviewElevationTarget(rawValue: 1)

    public static let allKnown: [CodeReviewElevationTarget] = [.pullRequestReview, .issues]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "PullRequestReview"
        case 1: return "Issues"
        default: return nil
        }
    }
}

/// Part of a review's identity: which pull request, range, working tree or snapshot.
public struct CodeReviewTarget: Codable, Hashable, Sendable {
    public var forgeKind: GitServiceKind
    public var canonicalAuthority: String
    public var repositoryOwner: String
    public var repositoryName: String
    public var pullRequestNumber: Int
    public var headSha: String
    public var kind: CodeReviewTargetKind
    /// `""` for a pull request.
    public var rangeBaseSha: String

    public init(
        forgeKind: GitServiceKind = GitServiceKind(rawValue: 0),
        canonicalAuthority: String = "",
        repositoryOwner: String = "",
        repositoryName: String = "",
        pullRequestNumber: Int = 0,
        headSha: String = "",
        kind: CodeReviewTargetKind = CodeReviewTargetKind(rawValue: 0),
        rangeBaseSha: String = ""
    ) {
        self.forgeKind = forgeKind
        self.canonicalAuthority = canonicalAuthority
        self.repositoryOwner = repositoryOwner
        self.repositoryName = repositoryName
        self.pullRequestNumber = pullRequestNumber
        self.headSha = headSha
        self.kind = kind
        self.rangeBaseSha = rangeBaseSha
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        forgeKind = c.lenient(.forgeKind) ?? GitServiceKind(rawValue: 0)
        canonicalAuthority = c.lenient(.canonicalAuthority) ?? ""
        repositoryOwner = c.lenient(.repositoryOwner) ?? ""
        repositoryName = c.lenient(.repositoryName) ?? ""
        pullRequestNumber = c.lenient(.pullRequestNumber) ?? 0
        headSha = c.lenient(.headSha) ?? ""
        kind = c.lenient(.kind) ?? CodeReviewTargetKind(rawValue: 0)
        rangeBaseSha = c.lenient(.rangeBaseSha) ?? ""
    }
}

/// A consolidated review's canonical findings by severity, and how many are still undecided.
public struct CodeReviewFindingCounts: Codable, Hashable, Sendable {
    public var p0: Int
    public var p1: Int
    public var p2: Int
    public var p3: Int
    public var open: Int

    public init(
        p0: Int = 0,
        p1: Int = 0,
        p2: Int = 0,
        p3: Int = 0,
        open: Int = 0
    ) {
        self.p0 = p0
        self.p1 = p1
        self.p2 = p2
        self.p3 = p3
        self.open = open
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        p0 = c.lenient(.p0) ?? 0
        p1 = c.lenient(.p1) ?? 0
        p2 = c.lenient(.p2) ?? 0
        p3 = c.lenient(.p3) ?? 0
        open = c.lenient(.open) ?? 0
    }
}

public struct CodeReviewCoverage: Codable, Hashable, Sendable {
    public var reviewed: Int
    public var inProgress: Int
    public var excluded: Int
    public var notReviewed: Int

    public init(
        reviewed: Int = 0,
        inProgress: Int = 0,
        excluded: Int = 0,
        notReviewed: Int = 0
    ) {
        self.reviewed = reviewed
        self.inProgress = inProgress
        self.excluded = excluded
        self.notReviewed = notReviewed
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reviewed = c.lenient(.reviewed) ?? 0
        inProgress = c.lenient(.inProgress) ?? 0
        excluded = c.lenient(.excluded) ?? 0
        notReviewed = c.lenient(.notReviewed) ?? 0
    }
}

/// One of the caller's reviews, as a list shows it.
public struct CodeReviewListItem: Codable, Hashable, Sendable {
    public var id: String
    public var target: CodeReviewTarget
    public var title: String?
    public var state: CodeReviewAnalysisState
    /// Null until capture is finalized.
    public var captureCompleteness: CodeReviewCaptureCompleteness?
    public var createdAt: String
    public var updatedAt: String
    /// The stored completeness verdict; null until capture is finalized.
    public var reviewCompleteness: CodeReviewCompleteness?
    /// Set once a newer head of the pull request was captured.
    public var supersededByRunId: String?
    /// Canonical finding counts; null until the review is consolidated.
    public var findings: CodeReviewFindingCounts?
    public var mode: CodeReviewMode
    public var source: CodeReviewSourceKind
    public var sourceSessionId: String?

    public init(
        id: String = "",
        target: CodeReviewTarget = CodeReviewTarget(),
        title: String? = nil,
        state: CodeReviewAnalysisState = CodeReviewAnalysisState(rawValue: 0),
        captureCompleteness: CodeReviewCaptureCompleteness? = nil,
        createdAt: String = "",
        updatedAt: String = "",
        reviewCompleteness: CodeReviewCompleteness? = nil,
        supersededByRunId: String? = nil,
        findings: CodeReviewFindingCounts? = nil,
        mode: CodeReviewMode = CodeReviewMode(rawValue: 0),
        source: CodeReviewSourceKind = CodeReviewSourceKind(rawValue: 0),
        sourceSessionId: String? = nil
    ) {
        self.id = id
        self.target = target
        self.title = title
        self.state = state
        self.captureCompleteness = captureCompleteness
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.reviewCompleteness = reviewCompleteness
        self.supersededByRunId = supersededByRunId
        self.findings = findings
        self.mode = mode
        self.source = source
        self.sourceSessionId = sourceSessionId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        target = c.lenient(.target) ?? CodeReviewTarget()
        title = c.lenient(.title)
        state = c.lenient(.state) ?? CodeReviewAnalysisState(rawValue: 0)
        captureCompleteness = c.lenient(.captureCompleteness)
        createdAt = c.lenient(.createdAt) ?? ""
        updatedAt = c.lenient(.updatedAt) ?? ""
        reviewCompleteness = c.lenient(.reviewCompleteness)
        supersededByRunId = c.lenient(.supersededByRunId)
        findings = c.lenient(.findings)
        mode = c.lenient(.mode) ?? CodeReviewMode(rawValue: 0)
        source = c.lenient(.source) ?? CodeReviewSourceKind(rawValue: 0)
        sourceSessionId = c.lenient(.sourceSessionId)
    }
}

public struct CodeReviewDispositionCount: Codable, Hashable, Sendable {
    public var disposition: CodeReviewManifestDisposition
    public var count: Int

    public init(
        disposition: CodeReviewManifestDisposition = CodeReviewManifestDisposition(rawValue: 0),
        count: Int = 0
    ) {
        self.disposition = disposition
        self.count = count
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        disposition = c.lenient(.disposition) ?? CodeReviewManifestDisposition(rawValue: 0)
        count = c.lenient(.count) ?? 0
    }
}

public struct CodeReviewWorkItemStateCount: Codable, Hashable, Sendable {
    public var state: CodeReviewWorkItemOutcome
    public var count: Int

    public init(
        state: CodeReviewWorkItemOutcome = CodeReviewWorkItemOutcome(rawValue: 0),
        count: Int = 0
    ) {
        self.state = state
        self.count = count
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = c.lenient(.state) ?? CodeReviewWorkItemOutcome(rawValue: 0)
        count = c.lenient(.count) ?? 0
    }
}

public struct CodeReviewCandidateStateCount: Codable, Hashable, Sendable {
    public var state: Int
    public var count: Int

    public init(
        state: Int = 0,
        count: Int = 0
    ) {
        self.state = state
        self.count = count
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = c.lenient(.state) ?? 0
        count = c.lenient(.count) ?? 0
    }
}

public struct CodeReviewWorkItemFailure: Codable, Hashable, Sendable {
    public var workItemKey: String
    public var kind: CodeReviewWorkKind
    public var lens: CodeReviewLens
    public var state: CodeReviewWorkItemOutcome
    public var failureClass: CodeReviewFailureClass?
    public var reason: String?
    public var attempts: Int

    public init(
        workItemKey: String = "",
        kind: CodeReviewWorkKind = CodeReviewWorkKind(rawValue: 0),
        lens: CodeReviewLens = CodeReviewLens(rawValue: 0),
        state: CodeReviewWorkItemOutcome = CodeReviewWorkItemOutcome(rawValue: 0),
        failureClass: CodeReviewFailureClass? = nil,
        reason: String? = nil,
        attempts: Int = 0
    ) {
        self.workItemKey = workItemKey
        self.kind = kind
        self.lens = lens
        self.state = state
        self.failureClass = failureClass
        self.reason = reason
        self.attempts = attempts
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workItemKey = c.lenient(.workItemKey) ?? ""
        kind = c.lenient(.kind) ?? CodeReviewWorkKind(rawValue: 0)
        lens = c.lenient(.lens) ?? CodeReviewLens(rawValue: 0)
        state = c.lenient(.state) ?? CodeReviewWorkItemOutcome(rawValue: 0)
        failureClass = c.lenient(.failureClass)
        reason = c.lenient(.reason)
        attempts = c.lenient(.attempts) ?? 0
    }
}

/// A review's progress as the API shows it.
public struct CodeReviewProgress: Codable, Hashable, Sendable {
    public var planned: Bool
    public var completeness: CodeReviewCompleteness
    public var partialReasons: [CodeReviewPlanPartialReason]
    public var workItems: [CodeReviewWorkItemStateCount]
    public var verifierItems: [CodeReviewWorkItemStateCount]
    public var candidates: [CodeReviewCandidateStateCount]
    /// Manifest files by coverage; null until a plan is stored.
    public var coverage: CodeReviewCoverage?
    public var failures: [CodeReviewWorkItemFailure]
    public var failuresOmitted: Int

    public init(
        planned: Bool = false,
        completeness: CodeReviewCompleteness = CodeReviewCompleteness(rawValue: 0),
        partialReasons: [CodeReviewPlanPartialReason] = [],
        workItems: [CodeReviewWorkItemStateCount] = [],
        verifierItems: [CodeReviewWorkItemStateCount] = [],
        candidates: [CodeReviewCandidateStateCount] = [],
        coverage: CodeReviewCoverage? = nil,
        failures: [CodeReviewWorkItemFailure] = [],
        failuresOmitted: Int = 0
    ) {
        self.planned = planned
        self.completeness = completeness
        self.partialReasons = partialReasons
        self.workItems = workItems
        self.verifierItems = verifierItems
        self.candidates = candidates
        self.coverage = coverage
        self.failures = failures
        self.failuresOmitted = failuresOmitted
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        planned = c.lenient(.planned) ?? false
        completeness = c.lenient(.completeness) ?? CodeReviewCompleteness(rawValue: 0)
        partialReasons = c.lenient(.partialReasons) ?? []
        workItems = c.lenient(.workItems) ?? []
        verifierItems = c.lenient(.verifierItems) ?? []
        candidates = c.lenient(.candidates) ?? []
        coverage = c.lenient(.coverage)
        failures = c.lenient(.failures) ?? []
        failuresOmitted = c.lenient(.failuresOmitted) ?? 0
    }
}

public struct CodeReviewManifestFile: Codable, Hashable, Sendable {
    public var ordinal: Int
    public var oldPath: String?
    public var newPath: String?
    public var changeKind: Int
    public var additions: Int
    public var deletions: Int
    public var isBinary: Bool
    public var isSubmodule: Bool
    public var hasModeChange: Bool
    public var isPatchMissing: Bool
    public var isPatchTruncated: Bool
    public var disposition: CodeReviewManifestDisposition
    public var contentDigest: String

    public init(
        ordinal: Int = 0,
        oldPath: String? = nil,
        newPath: String? = nil,
        changeKind: Int = 0,
        additions: Int = 0,
        deletions: Int = 0,
        isBinary: Bool = false,
        isSubmodule: Bool = false,
        hasModeChange: Bool = false,
        isPatchMissing: Bool = false,
        isPatchTruncated: Bool = false,
        disposition: CodeReviewManifestDisposition = CodeReviewManifestDisposition(rawValue: 0),
        contentDigest: String = ""
    ) {
        self.ordinal = ordinal
        self.oldPath = oldPath
        self.newPath = newPath
        self.changeKind = changeKind
        self.additions = additions
        self.deletions = deletions
        self.isBinary = isBinary
        self.isSubmodule = isSubmodule
        self.hasModeChange = hasModeChange
        self.isPatchMissing = isPatchMissing
        self.isPatchTruncated = isPatchTruncated
        self.disposition = disposition
        self.contentDigest = contentDigest
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ordinal = c.lenient(.ordinal) ?? 0
        oldPath = c.lenient(.oldPath)
        newPath = c.lenient(.newPath)
        changeKind = c.lenient(.changeKind) ?? 0
        additions = c.lenient(.additions) ?? 0
        deletions = c.lenient(.deletions) ?? 0
        isBinary = c.lenient(.isBinary) ?? false
        isSubmodule = c.lenient(.isSubmodule) ?? false
        hasModeChange = c.lenient(.hasModeChange) ?? false
        isPatchMissing = c.lenient(.isPatchMissing) ?? false
        isPatchTruncated = c.lenient(.isPatchTruncated) ?? false
        disposition = c.lenient(.disposition) ?? CodeReviewManifestDisposition(rawValue: 0)
        contentDigest = c.lenient(.contentDigest) ?? ""
    }
}

/// Metadata, capture and review completeness, and the manifest. Null until capture is finalized.
public struct CodeReviewSnapshot: Codable, Hashable, Sendable {
    public var forgeKind: GitServiceKind
    public var canonicalAuthority: String
    public var repositoryOwner: String
    public var repositoryName: String
    public var pullRequestNumber: Int
    public var title: String
    public var providerUrl: String
    public var state: String
    public var isDraft: Bool
    public var baseRef: String
    public var baseSha: String
    public var headRef: String
    public var headSha: String
    public var mergeBaseSha: String?
    public var files: [CodeReviewManifestFile]
    public var captureCompleteness: CodeReviewCaptureCompleteness
    public var reviewCompleteness: CodeReviewCompleteness
    public var incompleteReason: CodeReviewCaptureIncompleteReason
    public var metadataDigest: String
    public var manifestDigest: String
    public var snapshotDigest: String
    public var targetKind: CodeReviewTargetKind

    public init(
        forgeKind: GitServiceKind = GitServiceKind(rawValue: 0),
        canonicalAuthority: String = "",
        repositoryOwner: String = "",
        repositoryName: String = "",
        pullRequestNumber: Int = 0,
        title: String = "",
        providerUrl: String = "",
        state: String = "",
        isDraft: Bool = false,
        baseRef: String = "",
        baseSha: String = "",
        headRef: String = "",
        headSha: String = "",
        mergeBaseSha: String? = nil,
        files: [CodeReviewManifestFile] = [],
        captureCompleteness: CodeReviewCaptureCompleteness = CodeReviewCaptureCompleteness(rawValue: 0),
        reviewCompleteness: CodeReviewCompleteness = CodeReviewCompleteness(rawValue: 0),
        incompleteReason: CodeReviewCaptureIncompleteReason = CodeReviewCaptureIncompleteReason(rawValue: 0),
        metadataDigest: String = "",
        manifestDigest: String = "",
        snapshotDigest: String = "",
        targetKind: CodeReviewTargetKind = CodeReviewTargetKind(rawValue: 0)
    ) {
        self.forgeKind = forgeKind
        self.canonicalAuthority = canonicalAuthority
        self.repositoryOwner = repositoryOwner
        self.repositoryName = repositoryName
        self.pullRequestNumber = pullRequestNumber
        self.title = title
        self.providerUrl = providerUrl
        self.state = state
        self.isDraft = isDraft
        self.baseRef = baseRef
        self.baseSha = baseSha
        self.headRef = headRef
        self.headSha = headSha
        self.mergeBaseSha = mergeBaseSha
        self.files = files
        self.captureCompleteness = captureCompleteness
        self.reviewCompleteness = reviewCompleteness
        self.incompleteReason = incompleteReason
        self.metadataDigest = metadataDigest
        self.manifestDigest = manifestDigest
        self.snapshotDigest = snapshotDigest
        self.targetKind = targetKind
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        forgeKind = c.lenient(.forgeKind) ?? GitServiceKind(rawValue: 0)
        canonicalAuthority = c.lenient(.canonicalAuthority) ?? ""
        repositoryOwner = c.lenient(.repositoryOwner) ?? ""
        repositoryName = c.lenient(.repositoryName) ?? ""
        pullRequestNumber = c.lenient(.pullRequestNumber) ?? 0
        title = c.lenient(.title) ?? ""
        providerUrl = c.lenient(.providerUrl) ?? ""
        state = c.lenient(.state) ?? ""
        isDraft = c.lenient(.isDraft) ?? false
        baseRef = c.lenient(.baseRef) ?? ""
        baseSha = c.lenient(.baseSha) ?? ""
        headRef = c.lenient(.headRef) ?? ""
        headSha = c.lenient(.headSha) ?? ""
        mergeBaseSha = c.lenient(.mergeBaseSha)
        files = c.lenient(.files) ?? []
        captureCompleteness = c.lenient(.captureCompleteness) ?? CodeReviewCaptureCompleteness(rawValue: 0)
        reviewCompleteness = c.lenient(.reviewCompleteness) ?? CodeReviewCompleteness(rawValue: 0)
        incompleteReason = c.lenient(.incompleteReason) ?? CodeReviewCaptureIncompleteReason(rawValue: 0)
        metadataDigest = c.lenient(.metadataDigest) ?? ""
        manifestDigest = c.lenient(.manifestDigest) ?? ""
        snapshotDigest = c.lenient(.snapshotDigest) ?? ""
        targetKind = c.lenient(.targetKind) ?? CodeReviewTargetKind(rawValue: 0)
    }
}

public struct CodeReviewPolicy: Codable, Hashable, Sendable {
    public var maxChangedFiles: Int
    /// Everything else the server sent, by key.
    public var extra: [String: JSONValue]

    public init(
        maxChangedFiles: Int = 0,
        extra: [String: JSONValue] = [:]
    ) {
        self.maxChangedFiles = maxChangedFiles
        self.extra = extra
    }

    public init(from decoder: Decoder) throws {
        let all = (try? [String: JSONValue](from: decoder)) ?? [:]
        maxChangedFiles = all["maxChangedFiles"]?.decoded() ?? 0
        extra = all
    }

    public func encode(to encoder: Encoder) throws {
        try extra.encode(to: encoder)
    }
}

/// One review in full.
public struct CodeReviewDetail: Codable, Hashable, Sendable {
    public var id: String
    public var state: CodeReviewAnalysisState
    public var target: CodeReviewTarget
    public var pipelineVersion: Int
    public var policyDigest: String
    public var policy: CodeReviewPolicy
    public var createdAt: String
    public var updatedAt: String
    public var snapshotFinalizedAt: String?
    public var failureReason: String?
    public var supersededByRunId: String?
    public var supersededAt: String?
    public var fileCounts: [CodeReviewDispositionCount]
    public var snapshot: CodeReviewSnapshot?
    public var progress: CodeReviewProgress
    public var mode: CodeReviewMode
    public var source: CodeReviewSourceKind
    public var sourceSessionId: String?
    /// For code taken from a session: the workspace-relative directory it came from.
    public var sourcePath: String?

    public init(
        id: String = "",
        state: CodeReviewAnalysisState = CodeReviewAnalysisState(rawValue: 0),
        target: CodeReviewTarget = CodeReviewTarget(),
        pipelineVersion: Int = 0,
        policyDigest: String = "",
        policy: CodeReviewPolicy = CodeReviewPolicy(),
        createdAt: String = "",
        updatedAt: String = "",
        snapshotFinalizedAt: String? = nil,
        failureReason: String? = nil,
        supersededByRunId: String? = nil,
        supersededAt: String? = nil,
        fileCounts: [CodeReviewDispositionCount] = [],
        snapshot: CodeReviewSnapshot? = nil,
        progress: CodeReviewProgress = CodeReviewProgress(),
        mode: CodeReviewMode = CodeReviewMode(rawValue: 0),
        source: CodeReviewSourceKind = CodeReviewSourceKind(rawValue: 0),
        sourceSessionId: String? = nil,
        sourcePath: String? = nil
    ) {
        self.id = id
        self.state = state
        self.target = target
        self.pipelineVersion = pipelineVersion
        self.policyDigest = policyDigest
        self.policy = policy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.snapshotFinalizedAt = snapshotFinalizedAt
        self.failureReason = failureReason
        self.supersededByRunId = supersededByRunId
        self.supersededAt = supersededAt
        self.fileCounts = fileCounts
        self.snapshot = snapshot
        self.progress = progress
        self.mode = mode
        self.source = source
        self.sourceSessionId = sourceSessionId
        self.sourcePath = sourcePath
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        state = c.lenient(.state) ?? CodeReviewAnalysisState(rawValue: 0)
        target = c.lenient(.target) ?? CodeReviewTarget()
        pipelineVersion = c.lenient(.pipelineVersion) ?? 0
        policyDigest = c.lenient(.policyDigest) ?? ""
        policy = c.lenient(.policy) ?? CodeReviewPolicy()
        createdAt = c.lenient(.createdAt) ?? ""
        updatedAt = c.lenient(.updatedAt) ?? ""
        snapshotFinalizedAt = c.lenient(.snapshotFinalizedAt)
        failureReason = c.lenient(.failureReason)
        supersededByRunId = c.lenient(.supersededByRunId)
        supersededAt = c.lenient(.supersededAt)
        fileCounts = c.lenient(.fileCounts) ?? []
        snapshot = c.lenient(.snapshot)
        progress = c.lenient(.progress) ?? CodeReviewProgress()
        mode = c.lenient(.mode) ?? CodeReviewMode(rawValue: 0)
        source = c.lenient(.source) ?? CodeReviewSourceKind(rawValue: 0)
        sourceSessionId = c.lenient(.sourceSessionId)
        sourcePath = c.lenient(.sourcePath)
    }
}

/// One finding as a card lists it: enough to name it and point at its lines.
public struct CodeReviewFindingBrief: Codable, Hashable, Sendable {
    public var id: String
    public var rank: Int
    public var severity: CodeReviewSeverity
    public var title: String
    public var path: String
    public var side: CodeReviewAnchorSide
    public var startLine: Int
    public var endLine: Int
    public var provenance: CodeReviewFindingProvenance
    public var disposition: CodeReviewFindingDisposition

    public init(
        id: String = "",
        rank: Int = 0,
        severity: CodeReviewSeverity = CodeReviewSeverity(rawValue: 0),
        title: String = "",
        path: String = "",
        side: CodeReviewAnchorSide = CodeReviewAnchorSide(rawValue: 0),
        startLine: Int = 0,
        endLine: Int = 0,
        provenance: CodeReviewFindingProvenance = CodeReviewFindingProvenance(rawValue: 0),
        disposition: CodeReviewFindingDisposition = CodeReviewFindingDisposition(rawValue: 0)
    ) {
        self.id = id
        self.rank = rank
        self.severity = severity
        self.title = title
        self.path = path
        self.side = side
        self.startLine = startLine
        self.endLine = endLine
        self.provenance = provenance
        self.disposition = disposition
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        rank = c.lenient(.rank) ?? 0
        severity = c.lenient(.severity) ?? CodeReviewSeverity(rawValue: 0)
        title = c.lenient(.title) ?? ""
        path = c.lenient(.path) ?? ""
        side = c.lenient(.side) ?? CodeReviewAnchorSide(rawValue: 0)
        startLine = c.lenient(.startLine) ?? 0
        endLine = c.lenient(.endLine) ?? 0
        provenance = c.lenient(.provenance) ?? CodeReviewFindingProvenance(rawValue: 0)
        disposition = c.lenient(.disposition) ?? CodeReviewFindingDisposition(rawValue: 0)
    }
}

/// One review a session started, or that its agent commented on.
public struct CodeReviewSessionReview: Codable, Hashable, Sendable {
    public var review: CodeReviewListItem
    /// This session requested it (otherwise its agent only commented on it).
    public var startedHere: Bool
    public var sourcePath: String?
    public var incompleteReason: CodeReviewCaptureIncompleteReason
    public var coverage: CodeReviewCoverage?
    public var topFindings: [CodeReviewFindingBrief]
    public var findingTotal: Int
    public var elevation: CodeReviewElevationTarget?
    public var elevationBlocker: String?

    public init(
        review: CodeReviewListItem = CodeReviewListItem(),
        startedHere: Bool = false,
        sourcePath: String? = nil,
        incompleteReason: CodeReviewCaptureIncompleteReason = CodeReviewCaptureIncompleteReason(rawValue: 0),
        coverage: CodeReviewCoverage? = nil,
        topFindings: [CodeReviewFindingBrief] = [],
        findingTotal: Int = 0,
        elevation: CodeReviewElevationTarget? = nil,
        elevationBlocker: String? = nil
    ) {
        self.review = review
        self.startedHere = startedHere
        self.sourcePath = sourcePath
        self.incompleteReason = incompleteReason
        self.coverage = coverage
        self.topFindings = topFindings
        self.findingTotal = findingTotal
        self.elevation = elevation
        self.elevationBlocker = elevationBlocker
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        review = c.lenient(.review) ?? CodeReviewListItem()
        startedHere = c.lenient(.startedHere) ?? false
        sourcePath = c.lenient(.sourcePath)
        incompleteReason = c.lenient(.incompleteReason) ?? CodeReviewCaptureIncompleteReason(rawValue: 0)
        coverage = c.lenient(.coverage)
        topFindings = c.lenient(.topFindings) ?? []
        findingTotal = c.lenient(.findingTotal) ?? 0
        elevation = c.lenient(.elevation)
        elevationBlocker = c.lenient(.elevationBlocker)
    }
}

/// A finding's persisted ranking components, each 0 to 1000, and their weighted total.
public struct CodeReviewFindingScore: Codable, Hashable, Sendable {
    public var impact: Int
    public var triggerBreadth: Int
    public var evidenceQuality: Int
    public var verifierConfidence: Int
    public var ruleRelevance: Int
    public var duplicateSupport: Int
    public var total: Int

    public init(
        impact: Int = 0,
        triggerBreadth: Int = 0,
        evidenceQuality: Int = 0,
        verifierConfidence: Int = 0,
        ruleRelevance: Int = 0,
        duplicateSupport: Int = 0,
        total: Int = 0
    ) {
        self.impact = impact
        self.triggerBreadth = triggerBreadth
        self.evidenceQuality = evidenceQuality
        self.verifierConfidence = verifierConfidence
        self.ruleRelevance = ruleRelevance
        self.duplicateSupport = duplicateSupport
        self.total = total
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        impact = c.lenient(.impact) ?? 0
        triggerBreadth = c.lenient(.triggerBreadth) ?? 0
        evidenceQuality = c.lenient(.evidenceQuality) ?? 0
        verifierConfidence = c.lenient(.verifierConfidence) ?? 0
        ruleRelevance = c.lenient(.ruleRelevance) ?? 0
        duplicateSupport = c.lenient(.duplicateSupport) ?? 0
        total = c.lenient(.total) ?? 0
    }
}

/// A same-fingerprint finding the owner decided on in an earlier review of the same pull request.
public struct CodeReviewFindingPriorDisposition: Codable, Hashable, Sendable {
    public var reviewId: String
    public var headSha: String
    public var disposition: CodeReviewFindingDisposition
    public var decidedAt: String

    public init(
        reviewId: String = "",
        headSha: String = "",
        disposition: CodeReviewFindingDisposition = CodeReviewFindingDisposition(rawValue: 0),
        decidedAt: String = ""
    ) {
        self.reviewId = reviewId
        self.headSha = headSha
        self.disposition = disposition
        self.decidedAt = decidedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reviewId = c.lenient(.reviewId) ?? ""
        headSha = c.lenient(.headSha) ?? ""
        disposition = c.lenient(.disposition) ?? CodeReviewFindingDisposition(rawValue: 0)
        decidedAt = c.lenient(.decidedAt) ?? ""
    }
}

/// One canonical finding as a list shows it, in rank order.
public struct CodeReviewFindingSummary: Codable, Hashable, Sendable {
    public var id: String
    public var rank: Int
    public var fingerprint: String
    /// Bumped by every disposition change; an update must name the version it saw.
    public var version: Int
    public var category: CodeReviewCategory
    public var severity: CodeReviewSeverity
    public var path: String
    public var side: CodeReviewAnchorSide
    public var startLine: Int
    public var endLine: Int
    /// False for a summary-level finding (no changed line in its anchor).
    public var inline: Bool
    public var title: String
    public var score: CodeReviewFindingScore
    /// Past the policy's low-severity cap: kept and listed, flagged rather than dropped.
    public var capped: Bool
    /// Supported candidates merged into it.
    public var reports: Int
    public var disposition: CodeReviewFindingDisposition
    public var priorDisposition: CodeReviewFindingPriorDisposition?
    public var provenance: CodeReviewFindingProvenance
    public var authorSessionId: String?
    /// An agent comment carrying a suggested replacement for its anchored lines.
    public var hasSuggestion: Bool

    public init(
        id: String = "",
        rank: Int = 0,
        fingerprint: String = "",
        version: Int = 0,
        category: CodeReviewCategory = CodeReviewCategory(rawValue: 0),
        severity: CodeReviewSeverity = CodeReviewSeverity(rawValue: 0),
        path: String = "",
        side: CodeReviewAnchorSide = CodeReviewAnchorSide(rawValue: 0),
        startLine: Int = 0,
        endLine: Int = 0,
        inline: Bool = false,
        title: String = "",
        score: CodeReviewFindingScore = CodeReviewFindingScore(),
        capped: Bool = false,
        reports: Int = 0,
        disposition: CodeReviewFindingDisposition = CodeReviewFindingDisposition(rawValue: 0),
        priorDisposition: CodeReviewFindingPriorDisposition? = nil,
        provenance: CodeReviewFindingProvenance = CodeReviewFindingProvenance(rawValue: 0),
        authorSessionId: String? = nil,
        hasSuggestion: Bool = false
    ) {
        self.id = id
        self.rank = rank
        self.fingerprint = fingerprint
        self.version = version
        self.category = category
        self.severity = severity
        self.path = path
        self.side = side
        self.startLine = startLine
        self.endLine = endLine
        self.inline = inline
        self.title = title
        self.score = score
        self.capped = capped
        self.reports = reports
        self.disposition = disposition
        self.priorDisposition = priorDisposition
        self.provenance = provenance
        self.authorSessionId = authorSessionId
        self.hasSuggestion = hasSuggestion
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        rank = c.lenient(.rank) ?? 0
        fingerprint = c.lenient(.fingerprint) ?? ""
        version = c.lenient(.version) ?? 0
        category = c.lenient(.category) ?? CodeReviewCategory(rawValue: 0)
        severity = c.lenient(.severity) ?? CodeReviewSeverity(rawValue: 0)
        path = c.lenient(.path) ?? ""
        side = c.lenient(.side) ?? CodeReviewAnchorSide(rawValue: 0)
        startLine = c.lenient(.startLine) ?? 0
        endLine = c.lenient(.endLine) ?? 0
        inline = c.lenient(.inline) ?? false
        title = c.lenient(.title) ?? ""
        score = c.lenient(.score) ?? CodeReviewFindingScore()
        capped = c.lenient(.capped) ?? false
        reports = c.lenient(.reports) ?? 0
        disposition = c.lenient(.disposition) ?? CodeReviewFindingDisposition(rawValue: 0)
        priorDisposition = c.lenient(.priorDisposition)
        provenance = c.lenient(.provenance) ?? CodeReviewFindingProvenance(rawValue: 0)
        authorSessionId = c.lenient(.authorSessionId)
        hasSuggestion = c.lenient(.hasSuggestion) ?? false
    }
}

/// A review's canonical findings. `consolidationDigest` is null until the
/// review is consolidated (and `findings` empty); an update must name the
/// digest it saw.
public struct CodeReviewFindingList: Codable, Hashable, Sendable {
    public var reviewId: String
    public var state: CodeReviewAnalysisState
    public var consolidationDigest: String?
    /// True once a newer head was captured: findings stay readable but take no decisions.
    public var superseded: Bool
    public var findings: [CodeReviewFindingSummary]

    public init(
        reviewId: String = "",
        state: CodeReviewAnalysisState = CodeReviewAnalysisState(rawValue: 0),
        consolidationDigest: String? = nil,
        superseded: Bool = false,
        findings: [CodeReviewFindingSummary] = []
    ) {
        self.reviewId = reviewId
        self.state = state
        self.consolidationDigest = consolidationDigest
        self.superseded = superseded
        self.findings = findings
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reviewId = c.lenient(.reviewId) ?? ""
        state = c.lenient(.state) ?? CodeReviewAnalysisState(rawValue: 0)
        consolidationDigest = c.lenient(.consolidationDigest)
        superseded = c.lenient(.superseded) ?? false
        findings = c.lenient(.findings) ?? []
    }
}

/// What a disposition request did.
public struct CodeReviewFindingDispositionResult: Codable, Hashable, Sendable {
    public var findingId: String
    public var status: CodeReviewFindingUpdateStatus
    public var disposition: CodeReviewFindingDisposition
    public var version: Int

    public init(
        findingId: String = "",
        status: CodeReviewFindingUpdateStatus = CodeReviewFindingUpdateStatus(rawValue: 0),
        disposition: CodeReviewFindingDisposition = CodeReviewFindingDisposition(rawValue: 0),
        version: Int = 0
    ) {
        self.findingId = findingId
        self.status = status
        self.disposition = disposition
        self.version = version
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        findingId = c.lenient(.findingId) ?? ""
        status = c.lenient(.status) ?? CodeReviewFindingUpdateStatus(rawValue: 0)
        disposition = c.lenient(.disposition) ?? CodeReviewFindingDisposition(rawValue: 0)
        version = c.lenient(.version) ?? 0
    }
}

public struct CodeReviewCancelResult: Codable, Hashable, Sendable {
    public var reviewId: String
    public var cancelled: Bool
    public var state: CodeReviewAnalysisState

    public init(
        reviewId: String = "",
        cancelled: Bool = false,
        state: CodeReviewAnalysisState = CodeReviewAnalysisState(rawValue: 0)
    ) {
        self.reviewId = reviewId
        self.cancelled = cancelled
        self.state = state
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reviewId = c.lenient(.reviewId) ?? ""
        cancelled = c.lenient(.cancelled) ?? false
        state = c.lenient(.state) ?? CodeReviewAnalysisState(rawValue: 0)
    }
}

/// Accept, dismiss or reopen a finding, naming the version and digest the caller last read.
public struct CodeReviewFindingDispositionRequest: Codable, Hashable, Sendable {
    public var disposition: CodeReviewFindingDisposition
    public var expectedVersion: Int
    public var expectedConsolidationDigest: String

    public init(
        disposition: CodeReviewFindingDisposition = CodeReviewFindingDisposition(rawValue: 0),
        expectedVersion: Int = 0,
        expectedConsolidationDigest: String = ""
    ) {
        self.disposition = disposition
        self.expectedVersion = expectedVersion
        self.expectedConsolidationDigest = expectedConsolidationDigest
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        disposition = c.lenient(.disposition) ?? CodeReviewFindingDisposition(rawValue: 0)
        expectedVersion = c.lenient(.expectedVersion) ?? 0
        expectedConsolidationDigest = c.lenient(.expectedConsolidationDigest) ?? ""
    }
}

/// One finding in full, plus the report lineage and merged evidence.
public struct CodeReviewFindingDetail: Codable, Hashable, Sendable {
    public var reviewId: String
    public var consolidationDigest: String
    public var superseded: Bool
    public var finding: CodeReviewFindingSummary
    public var commitSha: String
    public var anchorSource: CodeReviewFindingSource
    public var severitySource: CodeReviewFindingSource
    public var trigger: String
    public var badBehavior: String
    public var causalChange: String
    public var suggestedRemediation: String
    public var verifierRationale: String
    public var lineage: [CodeReviewFindingReport]
    public var evidence: [CodeReviewFindingEvidence]
    public var evidenceOmitted: Int
    public var decidedAt: String?
    public var suggestion: String?

    public init(
        reviewId: String = "",
        consolidationDigest: String = "",
        superseded: Bool = false,
        finding: CodeReviewFindingSummary = CodeReviewFindingSummary(),
        commitSha: String = "",
        anchorSource: CodeReviewFindingSource = CodeReviewFindingSource(rawValue: 0),
        severitySource: CodeReviewFindingSource = CodeReviewFindingSource(rawValue: 0),
        trigger: String = "",
        badBehavior: String = "",
        causalChange: String = "",
        suggestedRemediation: String = "",
        verifierRationale: String = "",
        lineage: [CodeReviewFindingReport] = [],
        evidence: [CodeReviewFindingEvidence] = [],
        evidenceOmitted: Int = 0,
        decidedAt: String? = nil,
        suggestion: String? = nil
    ) {
        self.reviewId = reviewId
        self.consolidationDigest = consolidationDigest
        self.superseded = superseded
        self.finding = finding
        self.commitSha = commitSha
        self.anchorSource = anchorSource
        self.severitySource = severitySource
        self.trigger = trigger
        self.badBehavior = badBehavior
        self.causalChange = causalChange
        self.suggestedRemediation = suggestedRemediation
        self.verifierRationale = verifierRationale
        self.lineage = lineage
        self.evidence = evidence
        self.evidenceOmitted = evidenceOmitted
        self.decidedAt = decidedAt
        self.suggestion = suggestion
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reviewId = c.lenient(.reviewId) ?? ""
        consolidationDigest = c.lenient(.consolidationDigest) ?? ""
        superseded = c.lenient(.superseded) ?? false
        finding = c.lenient(.finding) ?? CodeReviewFindingSummary()
        commitSha = c.lenient(.commitSha) ?? ""
        anchorSource = c.lenient(.anchorSource) ?? CodeReviewFindingSource(rawValue: 0)
        severitySource = c.lenient(.severitySource) ?? CodeReviewFindingSource(rawValue: 0)
        trigger = c.lenient(.trigger) ?? ""
        badBehavior = c.lenient(.badBehavior) ?? ""
        causalChange = c.lenient(.causalChange) ?? ""
        suggestedRemediation = c.lenient(.suggestedRemediation) ?? ""
        verifierRationale = c.lenient(.verifierRationale) ?? ""
        lineage = c.lenient(.lineage) ?? []
        evidence = c.lenient(.evidence) ?? []
        evidenceOmitted = c.lenient(.evidenceOmitted) ?? 0
        decidedAt = c.lenient(.decidedAt)
        suggestion = c.lenient(.suggestion)
    }
}

public struct CodeReviewFindingReport: Codable, Hashable, Sendable {
    public var candidateId: String
    public var verdictId: String
    public var workItemKey: String
    public var lens: CodeReviewLens
    public var verificationRound: Int
    public var title: String
    public var candidateSeverity: CodeReviewSeverity
    public var correctedSeverity: CodeReviewSeverity?
    public var anchorCorrected: Bool
    public var representative: Bool
    public var mergeBasis: String?

    public init(
        candidateId: String = "",
        verdictId: String = "",
        workItemKey: String = "",
        lens: CodeReviewLens = CodeReviewLens(rawValue: 0),
        verificationRound: Int = 0,
        title: String = "",
        candidateSeverity: CodeReviewSeverity = CodeReviewSeverity(rawValue: 0),
        correctedSeverity: CodeReviewSeverity? = nil,
        anchorCorrected: Bool = false,
        representative: Bool = false,
        mergeBasis: String? = nil
    ) {
        self.candidateId = candidateId
        self.verdictId = verdictId
        self.workItemKey = workItemKey
        self.lens = lens
        self.verificationRound = verificationRound
        self.title = title
        self.candidateSeverity = candidateSeverity
        self.correctedSeverity = correctedSeverity
        self.anchorCorrected = anchorCorrected
        self.representative = representative
        self.mergeBasis = mergeBasis
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        candidateId = c.lenient(.candidateId) ?? ""
        verdictId = c.lenient(.verdictId) ?? ""
        workItemKey = c.lenient(.workItemKey) ?? ""
        lens = c.lenient(.lens) ?? CodeReviewLens(rawValue: 0)
        verificationRound = c.lenient(.verificationRound) ?? 0
        title = c.lenient(.title) ?? ""
        candidateSeverity = c.lenient(.candidateSeverity) ?? CodeReviewSeverity(rawValue: 0)
        correctedSeverity = c.lenient(.correctedSeverity)
        anchorCorrected = c.lenient(.anchorCorrected) ?? false
        representative = c.lenient(.representative) ?? false
        mergeBasis = c.lenient(.mergeBasis)
    }
}

public struct CodeReviewFindingEvidence: Codable, Hashable, Sendable {
    public var kind: String
    public var side: CodeReviewAnchorSide
    public var commitSha: String
    public var path: String
    public var startLine: Int
    public var endLine: Int
    /// `candidate` or `verdict`: who cited it first.
    public var source: String
    public var excerpt: String?
    public var citedBy: [String]

    public init(
        kind: String = "",
        side: CodeReviewAnchorSide = CodeReviewAnchorSide(rawValue: 0),
        commitSha: String = "",
        path: String = "",
        startLine: Int = 0,
        endLine: Int = 0,
        source: String = "",
        excerpt: String? = nil,
        citedBy: [String] = []
    ) {
        self.kind = kind
        self.side = side
        self.commitSha = commitSha
        self.path = path
        self.startLine = startLine
        self.endLine = endLine
        self.source = source
        self.excerpt = excerpt
        self.citedBy = citedBy
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.lenient(.kind) ?? ""
        side = c.lenient(.side) ?? CodeReviewAnchorSide(rawValue: 0)
        commitSha = c.lenient(.commitSha) ?? ""
        path = c.lenient(.path) ?? ""
        startLine = c.lenient(.startLine) ?? 0
        endLine = c.lenient(.endLine) ?? 0
        source = c.lenient(.source) ?? ""
        excerpt = c.lenient(.excerpt)
        citedBy = c.lenient(.citedBy) ?? []
    }
}

public struct CodeReviewFindingDiffStatus: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let available = CodeReviewFindingDiffStatus(rawValue: 0)
    public static let contentUnavailable = CodeReviewFindingDiffStatus(rawValue: 1)
    public static let anchorMismatch = CodeReviewFindingDiffStatus(rawValue: 2)

    public static let allKnown: [CodeReviewFindingDiffStatus] = [.available, .contentUnavailable, .anchorMismatch]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Available"
        case 1: return "ContentUnavailable"
        case 2: return "AnchorMismatch"
        default: return nil
        }
    }
}

public struct CodeReviewDiffLineKind: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let context = CodeReviewDiffLineKind(rawValue: 0)
    public static let add = CodeReviewDiffLineKind(rawValue: 1)
    public static let delete = CodeReviewDiffLineKind(rawValue: 2)

    public static let allKnown: [CodeReviewDiffLineKind] = [.context, .add, .delete]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Context"
        case 1: return "Add"
        case 2: return "Delete"
        default: return nil
        }
    }
}

public struct CodeReviewSuggestionStatus: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let available = CodeReviewSuggestionStatus(rawValue: 0)
    public static let contentUnavailable = CodeReviewSuggestionStatus(rawValue: 1)
    public static let baseMismatch = CodeReviewSuggestionStatus(rawValue: 2)

    public static let allKnown: [CodeReviewSuggestionStatus] = [.available, .contentUnavailable, .baseMismatch]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Available"
        case 1: return "ContentUnavailable"
        case 2: return "BaseMismatch"
        default: return nil
        }
    }
}

/// One line of a finding's anchored diff, typed by the server — never parsed client-side.
public struct CodeReviewFindingDiffLine: Codable, Hashable, Sendable {
    public var kind: CodeReviewDiffLineKind
    public var oldLine: Int?
    public var newLine: Int?
    public var text: String
    public var anchored: Bool
    public var textTruncated: Bool

    public init(
        kind: CodeReviewDiffLineKind = CodeReviewDiffLineKind(rawValue: 0),
        oldLine: Int? = nil,
        newLine: Int? = nil,
        text: String = "",
        anchored: Bool = false,
        textTruncated: Bool = false
    ) {
        self.kind = kind
        self.oldLine = oldLine
        self.newLine = newLine
        self.text = text
        self.anchored = anchored
        self.textTruncated = textTruncated
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.lenient(.kind) ?? CodeReviewDiffLineKind(rawValue: 0)
        oldLine = c.lenient(.oldLine)
        newLine = c.lenient(.newLine)
        text = c.lenient(.text) ?? ""
        anchored = c.lenient(.anchored) ?? false
        textTruncated = c.lenient(.textTruncated) ?? false
    }
}

public struct CodeReviewSuggestionLine: Codable, Hashable, Sendable {
    public var kind: CodeReviewDiffLineKind
    public var oldLine: Int?
    public var newLine: Int?
    public var text: String
    public var textTruncated: Bool

    public init(
        kind: CodeReviewDiffLineKind = CodeReviewDiffLineKind(rawValue: 0),
        oldLine: Int? = nil,
        newLine: Int? = nil,
        text: String = "",
        textTruncated: Bool = false
    ) {
        self.kind = kind
        self.oldLine = oldLine
        self.newLine = newLine
        self.text = text
        self.textTruncated = textTruncated
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.lenient(.kind) ?? CodeReviewDiffLineKind(rawValue: 0)
        oldLine = c.lenient(.oldLine)
        newLine = c.lenient(.newLine)
        text = c.lenient(.text) ?? ""
        textTruncated = c.lenient(.textTruncated) ?? false
    }
}

/// A finding's suggested replacement as a before/after line diff; text only.
public struct CodeReviewFindingSuggestion: Codable, Hashable, Sendable {
    public var status: CodeReviewSuggestionStatus
    public var applicable: Bool
    public var lines: [CodeReviewSuggestionLine]

    public init(
        status: CodeReviewSuggestionStatus = CodeReviewSuggestionStatus(rawValue: 0),
        applicable: Bool = false,
        lines: [CodeReviewSuggestionLine] = []
    ) {
        self.status = status
        self.applicable = applicable
        self.lines = lines
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = c.lenient(.status) ?? CodeReviewSuggestionStatus(rawValue: 0)
        applicable = c.lenient(.applicable) ?? false
        lines = c.lenient(.lines) ?? []
    }
}

/// The finding's anchored lines with context, read from the review's pinned commits by the server.
public struct CodeReviewFindingDiff: Codable, Hashable, Sendable {
    public var findingId: String
    public var status: CodeReviewFindingDiffStatus
    public var path: String
    public var side: CodeReviewAnchorSide
    public var startLine: Int
    public var endLine: Int
    public var fromSha: String?
    public var headSha: String?
    public var lines: [CodeReviewFindingDiffLine]
    public var truncated: Bool
    public var suggestion: CodeReviewFindingSuggestion?

    public init(
        findingId: String = "",
        status: CodeReviewFindingDiffStatus = CodeReviewFindingDiffStatus(rawValue: 0),
        path: String = "",
        side: CodeReviewAnchorSide = CodeReviewAnchorSide(rawValue: 0),
        startLine: Int = 0,
        endLine: Int = 0,
        fromSha: String? = nil,
        headSha: String? = nil,
        lines: [CodeReviewFindingDiffLine] = [],
        truncated: Bool = false,
        suggestion: CodeReviewFindingSuggestion? = nil
    ) {
        self.findingId = findingId
        self.status = status
        self.path = path
        self.side = side
        self.startLine = startLine
        self.endLine = endLine
        self.fromSha = fromSha
        self.headSha = headSha
        self.lines = lines
        self.truncated = truncated
        self.suggestion = suggestion
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        findingId = c.lenient(.findingId) ?? ""
        status = c.lenient(.status) ?? CodeReviewFindingDiffStatus(rawValue: 0)
        path = c.lenient(.path) ?? ""
        side = c.lenient(.side) ?? CodeReviewAnchorSide(rawValue: 0)
        startLine = c.lenient(.startLine) ?? 0
        endLine = c.lenient(.endLine) ?? 0
        fromSha = c.lenient(.fromSha)
        headSha = c.lenient(.headSha)
        lines = c.lenient(.lines) ?? []
        truncated = c.lenient(.truncated) ?? false
        suggestion = c.lenient(.suggestion)
    }
}

// -- publications --

public struct CodeReviewPublicationEvent: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let comment = CodeReviewPublicationEvent(rawValue: 0)
    public static let requestChanges = CodeReviewPublicationEvent(rawValue: 1)

    public static let allKnown: [CodeReviewPublicationEvent] = [.comment, .requestChanges]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Comment"
        case 1: return "RequestChanges"
        default: return nil
        }
    }
}

public struct CodeReviewPublicationState: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let pending = CodeReviewPublicationState(rawValue: 0)
    public static let publishing = CodeReviewPublicationState(rawValue: 1)
    public static let partiallyPublished = CodeReviewPublicationState(rawValue: 2)
    public static let published = CodeReviewPublicationState(rawValue: 3)
    public static let failed = CodeReviewPublicationState(rawValue: 4)
    public static let obsolete = CodeReviewPublicationState(rawValue: 5)

    public static let allKnown: [CodeReviewPublicationState] = [.pending, .publishing, .partiallyPublished, .published, .failed, .obsolete]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Pending"
        case 1: return "Publishing"
        case 2: return "PartiallyPublished"
        case 3: return "Published"
        case 4: return "Failed"
        case 5: return "Obsolete"
        default: return nil
        }
    }
}

public struct CodeReviewPublicationItemState: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let pending = CodeReviewPublicationItemState(rawValue: 0)
    public static let published = CodeReviewPublicationItemState(rawValue: 1)
    public static let failed = CodeReviewPublicationItemState(rawValue: 2)
    public static let notPublishable = CodeReviewPublicationItemState(rawValue: 3)
    public static let obsolete = CodeReviewPublicationItemState(rawValue: 4)

    public static let allKnown: [CodeReviewPublicationItemState] = [.pending, .published, .failed, .notPublishable, .obsolete]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Pending"
        case 1: return "Published"
        case 2: return "Failed"
        case 3: return "NotPublishable"
        case 4: return "Obsolete"
        default: return nil
        }
    }
}

public struct CodeReviewPublicationPlacement: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let inline = CodeReviewPublicationPlacement(rawValue: 0)
    public static let summary = CodeReviewPublicationPlacement(rawValue: 1)
    public static let issue = CodeReviewPublicationPlacement(rawValue: 2)

    public static let allKnown: [CodeReviewPublicationPlacement] = [.inline, .summary, .issue]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Inline"
        case 1: return "Summary"
        case 2: return "Issue"
        default: return nil
        }
    }
}

public struct CodeReviewPublishStatus: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let ran = CodeReviewPublishStatus(rawValue: 0)
    public static let replayed = CodeReviewPublishStatus(rawValue: 1)
    public static let notConfirmed = CodeReviewPublishStatus(rawValue: 2)
    public static let invalid = CodeReviewPublishStatus(rawValue: 3)
    public static let notPublishable = CodeReviewPublishStatus(rawValue: 4)
    public static let alreadyPublished = CodeReviewPublishStatus(rawValue: 5)
    public static let busy = CodeReviewPublishStatus(rawValue: 6)
    public static let headMoved = CodeReviewPublishStatus(rawValue: 7)
    public static let connectionUnavailable = CodeReviewPublishStatus(rawValue: 8)
    public static let forgeUnavailable = CodeReviewPublishStatus(rawValue: 9)

    public static let allKnown: [CodeReviewPublishStatus] = [.ran, .replayed, .notConfirmed, .invalid, .notPublishable, .alreadyPublished, .busy, .headMoved, .connectionUnavailable, .forgeUnavailable]

    /// The member's name as the server spells it, or nil for a number this build does not know.
    public var name: String? {
        switch rawValue {
        case 0: return "Ran"
        case 1: return "Replayed"
        case 2: return "NotConfirmed"
        case 3: return "Invalid"
        case 4: return "NotPublishable"
        case 5: return "AlreadyPublished"
        case 6: return "Busy"
        case 7: return "HeadMoved"
        case 8: return "ConnectionUnavailable"
        case 9: return "ForgeUnavailable"
        default: return nil
        }
    }
}

/// Only ids and a choice: the server renders every body and places every comment itself.
public struct CodeReviewPublishRequest: Codable, Hashable, Sendable {
    /// Made once when the confirmation opens; a replay returns the publication it created.
    public var requestId: String
    public var findingIds: [String]
    public var event: CodeReviewPublicationEvent
    public var confirmed: Bool

    public init(
        requestId: String = "",
        findingIds: [String] = [],
        event: CodeReviewPublicationEvent = CodeReviewPublicationEvent(rawValue: 0),
        confirmed: Bool = false
    ) {
        self.requestId = requestId
        self.findingIds = findingIds
        self.event = event
        self.confirmed = confirmed
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requestId = c.lenient(.requestId) ?? ""
        findingIds = c.lenient(.findingIds) ?? []
        event = c.lenient(.event) ?? CodeReviewPublicationEvent(rawValue: 0)
        confirmed = c.lenient(.confirmed) ?? false
    }
}

public struct CodeReviewPublishResult: Codable, Hashable, Sendable {
    public var status: CodeReviewPublishStatus
    public var reason: String?
    public var publication: CodeReviewPublicationView?

    public init(
        status: CodeReviewPublishStatus = CodeReviewPublishStatus(rawValue: 0),
        reason: String? = nil,
        publication: CodeReviewPublicationView? = nil
    ) {
        self.status = status
        self.reason = reason
        self.publication = publication
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = c.lenient(.status) ?? CodeReviewPublishStatus(rawValue: 0)
        reason = c.lenient(.reason)
        publication = c.lenient(.publication)
    }
}

public struct CodeReviewPublicationItemView: Codable, Hashable, Sendable {
    public var findingId: String
    public var rank: Int
    public var severity: CodeReviewSeverity
    public var title: String
    public var placement: CodeReviewPublicationPlacement?
    public var state: CodeReviewPublicationItemState
    /// The comment's, the issue's, or the review's link; http(s) only.
    public var remoteUrl: String?
    public var attempts: Int
    public var error: String?

    public init(
        findingId: String = "",
        rank: Int = 0,
        severity: CodeReviewSeverity = CodeReviewSeverity(rawValue: 0),
        title: String = "",
        placement: CodeReviewPublicationPlacement? = nil,
        state: CodeReviewPublicationItemState = CodeReviewPublicationItemState(rawValue: 0),
        remoteUrl: String? = nil,
        attempts: Int = 0,
        error: String? = nil
    ) {
        self.findingId = findingId
        self.rank = rank
        self.severity = severity
        self.title = title
        self.placement = placement
        self.state = state
        self.remoteUrl = remoteUrl
        self.attempts = attempts
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        findingId = c.lenient(.findingId) ?? ""
        rank = c.lenient(.rank) ?? 0
        severity = c.lenient(.severity) ?? CodeReviewSeverity(rawValue: 0)
        title = c.lenient(.title) ?? ""
        placement = c.lenient(.placement)
        state = c.lenient(.state) ?? CodeReviewPublicationItemState(rawValue: 0)
        remoteUrl = c.lenient(.remoteUrl)
        attempts = c.lenient(.attempts) ?? 0
        error = c.lenient(.error)
    }
}

public struct CodeReviewPublicationView: Codable, Hashable, Sendable {
    public var id: String
    public var state: CodeReviewPublicationState
    public var event: CodeReviewPublicationEvent
    public var headSha: String
    public var confirmedAt: String
    public var updatedAt: String
    public var attempts: Int
    public var remoteReviewUrl: String?
    public var remoteSubmitted: Bool
    public var error: String?
    public var items: [CodeReviewPublicationItemView]
    public var target: CodeReviewElevationTarget

    public init(
        id: String = "",
        state: CodeReviewPublicationState = CodeReviewPublicationState(rawValue: 0),
        event: CodeReviewPublicationEvent = CodeReviewPublicationEvent(rawValue: 0),
        headSha: String = "",
        confirmedAt: String = "",
        updatedAt: String = "",
        attempts: Int = 0,
        remoteReviewUrl: String? = nil,
        remoteSubmitted: Bool = false,
        error: String? = nil,
        items: [CodeReviewPublicationItemView] = [],
        target: CodeReviewElevationTarget = CodeReviewElevationTarget(rawValue: 0)
    ) {
        self.id = id
        self.state = state
        self.event = event
        self.headSha = headSha
        self.confirmedAt = confirmedAt
        self.updatedAt = updatedAt
        self.attempts = attempts
        self.remoteReviewUrl = remoteReviewUrl
        self.remoteSubmitted = remoteSubmitted
        self.error = error
        self.items = items
        self.target = target
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id) ?? ""
        state = c.lenient(.state) ?? CodeReviewPublicationState(rawValue: 0)
        event = c.lenient(.event) ?? CodeReviewPublicationEvent(rawValue: 0)
        headSha = c.lenient(.headSha) ?? ""
        confirmedAt = c.lenient(.confirmedAt) ?? ""
        updatedAt = c.lenient(.updatedAt) ?? ""
        attempts = c.lenient(.attempts) ?? 0
        remoteReviewUrl = c.lenient(.remoteReviewUrl)
        remoteSubmitted = c.lenient(.remoteSubmitted) ?? false
        error = c.lenient(.error)
        items = c.lenient(.items) ?? []
        target = c.lenient(.target) ?? CodeReviewElevationTarget(rawValue: 0)
    }
}

/// Whether one of the review's findings could be published, and where it would go.
public struct CodeReviewPublishableFinding: Codable, Hashable, Sendable {
    public var findingId: String
    public var placement: CodeReviewPublicationPlacement?
    public var refusal: String?
    public var publishedIn: String?

    public init(
        findingId: String = "",
        placement: CodeReviewPublicationPlacement? = nil,
        refusal: String? = nil,
        publishedIn: String? = nil
    ) {
        self.findingId = findingId
        self.placement = placement
        self.refusal = refusal
        self.publishedIn = publishedIn
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        findingId = c.lenient(.findingId) ?? ""
        placement = c.lenient(.placement)
        refusal = c.lenient(.refusal)
        publishedIn = c.lenient(.publishedIn)
    }
}

public struct CodeReviewPublicationOverview: Codable, Hashable, Sendable {
    public var reviewId: String
    public var canPublish: Bool
    public var blocker: String?
    public var completeness: CodeReviewCompleteness
    public var findings: [CodeReviewPublishableFinding]
    public var publications: [CodeReviewPublicationView]
    public var target: CodeReviewElevationTarget?
    public var repository: String?

    public init(
        reviewId: String = "",
        canPublish: Bool = false,
        blocker: String? = nil,
        completeness: CodeReviewCompleteness = CodeReviewCompleteness(rawValue: 0),
        findings: [CodeReviewPublishableFinding] = [],
        publications: [CodeReviewPublicationView] = [],
        target: CodeReviewElevationTarget? = nil,
        repository: String? = nil
    ) {
        self.reviewId = reviewId
        self.canPublish = canPublish
        self.blocker = blocker
        self.completeness = completeness
        self.findings = findings
        self.publications = publications
        self.target = target
        self.repository = repository
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reviewId = c.lenient(.reviewId) ?? ""
        canPublish = c.lenient(.canPublish) ?? false
        blocker = c.lenient(.blocker)
        completeness = c.lenient(.completeness) ?? CodeReviewCompleteness(rawValue: 0)
        findings = c.lenient(.findings) ?? []
        publications = c.lenient(.publications) ?? []
        target = c.lenient(.target)
        repository = c.lenient(.repository)
    }
}

/// Which findings to preview and as what event; nothing is sent.
public struct CodeReviewPublicationPreviewRequest: Codable, Hashable, Sendable {
    public var findingIds: [String]
    public var event: CodeReviewPublicationEvent

    public init(
        findingIds: [String] = [],
        event: CodeReviewPublicationEvent = CodeReviewPublicationEvent(rawValue: 0)
    ) {
        self.findingIds = findingIds
        self.event = event
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        findingIds = c.lenient(.findingIds) ?? []
        event = c.lenient(.event) ?? CodeReviewPublicationEvent(rawValue: 0)
    }
}

/// Try an unfinished publication again; the server reconciles with the forge before it writes.
public struct CodeReviewPublicationRetryRequest: Codable, Hashable, Sendable {
    public var confirmed: Bool

    public init(
        confirmed: Bool = false
    ) {
        self.confirmed = confirmed
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        confirmed = c.lenient(.confirmed) ?? false
    }
}

public struct CodeReviewPublicationPreviewItem: Codable, Hashable, Sendable {
    public var findingId: String
    public var rank: Int
    public var severity: CodeReviewSeverity
    public var title: String
    public var placement: CodeReviewPublicationPlacement?
    public var path: String
    public var side: CodeReviewAnchorSide
    public var startLine: Int?
    public var line: Int
    /// The server-rendered comment body; null for a summary finding (part of the review body).
    public var body: String?
    public var refusal: String?
    /// For an issue: its title, exactly as it would be posted.
    public var issueTitle: String?

    public init(
        findingId: String = "",
        rank: Int = 0,
        severity: CodeReviewSeverity = CodeReviewSeverity(rawValue: 0),
        title: String = "",
        placement: CodeReviewPublicationPlacement? = nil,
        path: String = "",
        side: CodeReviewAnchorSide = CodeReviewAnchorSide(rawValue: 0),
        startLine: Int? = nil,
        line: Int = 0,
        body: String? = nil,
        refusal: String? = nil,
        issueTitle: String? = nil
    ) {
        self.findingId = findingId
        self.rank = rank
        self.severity = severity
        self.title = title
        self.placement = placement
        self.path = path
        self.side = side
        self.startLine = startLine
        self.line = line
        self.body = body
        self.refusal = refusal
        self.issueTitle = issueTitle
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        findingId = c.lenient(.findingId) ?? ""
        rank = c.lenient(.rank) ?? 0
        severity = c.lenient(.severity) ?? CodeReviewSeverity(rawValue: 0)
        title = c.lenient(.title) ?? ""
        placement = c.lenient(.placement)
        path = c.lenient(.path) ?? ""
        side = c.lenient(.side) ?? CodeReviewAnchorSide(rawValue: 0)
        startLine = c.lenient(.startLine)
        line = c.lenient(.line) ?? 0
        body = c.lenient(.body)
        refusal = c.lenient(.refusal)
        issueTitle = c.lenient(.issueTitle)
    }
}

/// Exactly what a publication would post — the review body and each inline comment, as text.
public struct CodeReviewPublicationPreview: Codable, Hashable, Sendable {
    public var reviewId: String
    public var headSha: String
    public var event: CodeReviewPublicationEvent
    public var completeness: CodeReviewCompleteness
    public var coverageNotice: String?
    public var reviewBody: String
    public var items: [CodeReviewPublicationPreviewItem]
    public var target: CodeReviewElevationTarget
    public var repository: String?

    public init(
        reviewId: String = "",
        headSha: String = "",
        event: CodeReviewPublicationEvent = CodeReviewPublicationEvent(rawValue: 0),
        completeness: CodeReviewCompleteness = CodeReviewCompleteness(rawValue: 0),
        coverageNotice: String? = nil,
        reviewBody: String = "",
        items: [CodeReviewPublicationPreviewItem] = [],
        target: CodeReviewElevationTarget = CodeReviewElevationTarget(rawValue: 0),
        repository: String? = nil
    ) {
        self.reviewId = reviewId
        self.headSha = headSha
        self.event = event
        self.completeness = completeness
        self.coverageNotice = coverageNotice
        self.reviewBody = reviewBody
        self.items = items
        self.target = target
        self.repository = repository
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reviewId = c.lenient(.reviewId) ?? ""
        headSha = c.lenient(.headSha) ?? ""
        event = c.lenient(.event) ?? CodeReviewPublicationEvent(rawValue: 0)
        completeness = c.lenient(.completeness) ?? CodeReviewCompleteness(rawValue: 0)
        coverageNotice = c.lenient(.coverageNotice)
        reviewBody = c.lenient(.reviewBody) ?? ""
        items = c.lenient(.items) ?? []
        target = c.lenient(.target) ?? CodeReviewElevationTarget(rawValue: 0)
        repository = c.lenient(.repository)
    }
}

// ---- git identity ----

/// The default author a user's session sandboxes commit as. Null or blank: leave it unset.
public struct GitIdentityPrefs: Codable, Hashable, Sendable {
    public var name: String?
    public var email: String?

    public init(
        name: String? = nil,
        email: String? = nil
    ) {
        self.name = name
        self.email = email
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lenient(.name)
        email = c.lenient(.email)
    }
}

