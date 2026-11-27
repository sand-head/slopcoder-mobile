// What a turn's dials say, worked out once for whoever shows them: the
// composer on the sessions page, and a session's own panel.

import Foundation

public struct TurnDials {
    public let options: TurnOptions
    public let models: [ModelCandidate]
    /// The model an Auto session last routed to, whose dial this one follows.
    public var routed: (connectionId: String?, modelId: String?)?

    public init(options: TurnOptions, models: [ModelCandidate], routed: (connectionId: String?, modelId: String?)? = nil) {
        self.options = options
        self.models = models
        self.routed = routed
    }

    public var current: ModelCandidate? {
        options.selection.auto ? nil : findCandidate(models, connectionId: options.selection.connectionId, modelId: options.selection.modelId)
    }

    public var caps: ThinkingCaps? {
        let candidate = options.selection.auto
            ? findCandidate(models, connectionId: routed?.connectionId, modelId: routed?.modelId)
            : current
        return candidate.map(ThinkingCaps.init)
    }

    public var modelLabel: String {
        options.selection.auto ? "Auto" : current?.modelDisplayName ?? "Model"
    }

    /// A stale pick is shown as what it runs as, not as what was picked.
    public var shownThinking: ThinkingLevel? {
        options.thinking.map { runsAs($0, caps) }
    }

    public var thinkingLabel: String { shownThinking.map { levelLabel($0, caps) } ?? "Auto" }
    public var approvalLabel: String { ApprovalChoice.label(for: options.approval) }
}
