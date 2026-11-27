// A small, fixed world for the app to run against when nothing real is there:
// the UI tests' server.
//
// Everything here is built from the contract types the app decodes and is
// encoded with the app's own `Wire`, so it cannot describe a shape the real
// server never sends. It is switched on only by a launch argument (`StubMode`)
// and holds nothing that reaches the network.

import Foundation

/// Whether this launch asked for the stub: `-SlopcoderStub 1` on the command
/// line, which is how a UI test launches the app and how nothing else does.
public enum StubMode {
    public static let argument = "-SlopcoderStub"

    public static func requested(in arguments: [String]) -> Bool {
        guard let index = arguments.firstIndex(of: argument), index + 1 < arguments.count else { return false }
        return ["1", "yes", "true"].contains(arguments[index + 1].lowercased())
    }

    /// Who the stub is signed in as. `.invalid` is reserved never to resolve,
    /// so a request that somehow went past the stub fails instead of reaching
    /// anyone.
    public static let credential = Credential(server: "https://stub.invalid", apiKey: "stub-key", userName: "stub")
}

/// The canned data, by name, for the server and for tests that check it.
public enum StubWorld {
    public static let idleId = "0199aa00-0000-7000-8000-000000000001"
    public static let runningId = "0199aa00-0000-7000-8000-000000000002"
    public static let routineId = "0199aa00-0000-7000-8000-0000000000r1"
    public static let artifactId = "0199aa00-0000-7000-8000-0000000000a1"

    public static let idleTitle = "Fix the flaky upload test"
    public static let runningTitle = "Move the hub to long polling"
    /// The last thing the agent said in the idle session: the line a UI test
    /// looks for to prove the transcript opens at its end.
    public static let lastWords = "The upload test passes ten runs in a row now."
    /// What the agent answers to anything sent in the stub.
    public static let reply = "Noted. This is the stub server, so nothing ran."

    static let morning = "2026-11-27T09:00:00Z"
    static let later = "2026-11-27T09:04:00Z"

    public static let models: [ModelCandidate] = [
        ModelCandidate(
            connectionId: "c1", connectionName: "Anthropic", kind: 0, modelId: "claude-opus-5-5",
            modelDisplayName: "Claude Opus 5.5", tier: 3, contextWindowTokens: 200_000,
            supportedThinkingLevels: [.low, .medium, .high]
        ),
        ModelCandidate(
            connectionId: "c1", connectionName: "Anthropic", kind: 0, modelId: "claude-haiku-5-5",
            modelDisplayName: "Claude Haiku 5.5", tier: 1, contextWindowTokens: 200_000
        ),
    ]

    public static let facets: [FacetOption] = [
        FacetOption(name: "execute", description: "Do the work"),
        FacetOption(name: "review", description: "Read and comment, change nothing"),
    ]

    public static var sessions: [SessionSummary] {
        [
            SessionSummary(
                id: runningId, title: runningTitle, model: "claude-opus-5-5", autoRoute: false,
                status: .running, createdAt: morning, updatedAt: later, repoNames: ["slopcoder"]
            ),
            SessionSummary(
                id: idleId, title: idleTitle, model: "claude-opus-5-5", autoRoute: false,
                status: .idle, createdAt: morning, updatedAt: later, repoNames: ["slopcoder"]
            ),
        ]
    }

    static func event(_ ordinal: Int, _ kind: String, _ payload: JSONValue) -> AgentEventEnvelope {
        AgentEventEnvelope(ordinal: ordinal, kind: kind, payloadJson: payload.serialized())
    }

    /// The idle session's transcript: a prompt, a tool call, a markdown answer
    /// and the turn closing.
    static var idleEvents: [AgentEventEnvelope] {
        [
            event(0, "UserPrompt", ["text": "The upload test fails about one run in five. Find out why and fix it.", "at": .string(morning)]),
            event(1, "ToolCallStarted", ["toolName": "Bash", "inputJson": #"{"command":"swift test --filter UploadTests"}"#, "at": .string(morning)]),
            event(2, "ToolCallFinished", ["toolName": "Bash", "result": "Test Suite 'UploadTests' passed.", "isError": false]),
            event(3, "AssistantText", [
                "text": .string("""
                The test raced the upload's **completion handler** against its timeout:

                - the handler ran on a background queue
                - the assertion read the result before it had landed

                I made the test await the upload instead. \(lastWords)
                """),
                "at": .string(later),
            ]),
            event(4, "TurnCompleted", ["durationMs": 241_000]),
        ]
    }

    static var runningEvents: [AgentEventEnvelope] {
        [
            event(0, "UserPrompt", ["text": "Move the hub's fallback from SSE to long polling.", "at": .string(morning)]),
            event(1, "ToolCallStarted", ["toolName": "Read", "inputJson": #"{"file_path":"Sources/SlopcoderCore/API/Hub.swift"}"#]),
        ]
    }

    static func state(_ summary: SessionSummary, nextOrdinal: Int) -> SessionState {
        SessionState(
            id: summary.id, title: summary.title, status: summary.status,
            connectionId: "c1", selectedModel: "claude-opus-5-5", autoRoute: false,
            thinkingLevel: .medium, approvalMode: .dangerous, useClassifier: true, facetName: "execute",
            repoNames: summary.repoNames ?? [], nextOrdinal: nextOrdinal,
            live: summary.status == .running ? LiveSnapshot(thinking: "", text: "Reading the hub's transports") : nil,
            facetCatalog: facets,
            lastUsage: UsageReport(inputTokens: 41_000, contextWindowTokens: 200_000),
            usage: UsageSummary(models: [], estimatedCost: 0.42)
        )
    }

    public static let routine = AutomationSummary(
        id: routineId, name: "morning-digest", kind: .job, prompt: "Check last night's deploy and tell me if anything looks wrong.",
        cronExpression: "0 7 * * 1-5", timeZoneId: "UTC", enabled: true, scheduleEnabled: true, facet: "execute",
        deliveryKind: .push, createdAt: morning, updatedAt: morning
    )

    public static let artifact = ArtifactSummary(
        id: artifactId, slug: "upload-race", title: "Why the upload test was flaky", format: .markdown,
        contentType: "text/markdown", description: "The race, and the fix", preview: "The test raced the upload's completion handler…",
        size: 512, version: 1, sessionId: idleId, sessionTitle: idleTitle, createdAt: later, updatedAt: later
    )
}
