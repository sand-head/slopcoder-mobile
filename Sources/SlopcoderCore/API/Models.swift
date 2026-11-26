// What a model offers, and in what order the models are listed — ported from
// `SlopCoder.Contracts/ThinkingLevel.cs` (`ThinkingLevels`), the web's
// `ThinkingPicker.razor` helpers, and `ModelOrdering.cs`.
//
// A persisted thinking pick can outlive the model it was made on (an Auto
// turn, a model switch), so every level still has to land somewhere. The
// providers map an unoffered level the same way `runsAs` does, and the dial
// shows that rather than the stale pick — otherwise the phone would say "Off"
// over a turn that is about to think at Low.

import Foundation

/// What a model says about thinking; both fields absent means unknown.
public struct ThinkingCaps: Hashable, Sendable {
    public var supportedThinkingLevels: [ThinkingLevel]?
    public var alwaysThinks: Bool

    public init(supportedThinkingLevels: [ThinkingLevel]? = nil, alwaysThinks: Bool = false) {
        self.supportedThinkingLevels = supportedThinkingLevels
        self.alwaysThinks = alwaysThinks
    }

    public init(_ model: ModelCandidate) {
        self.init(supportedThinkingLevels: model.supportedThinkingLevels, alwaysThinks: model.alwaysThinks ?? false)
    }
}

private let allEfforts: [ThinkingLevel] = [.low, .medium, .high, .max]

private func efforts(_ supported: [ThinkingLevel]?) -> [ThinkingLevel] {
    let listed = (supported ?? []).filter { $0 != .off }
    if listed.isEmpty { return allEfforts }
    return Array(Set(listed)).sorted { $0.rawValue < $1.rawValue }
}

/// The levels to offer, in dial order. Unknown support offers every effort; Off
/// is offered unless the model always thinks.
public func offeredLevels(_ caps: ThinkingCaps?) -> [ThinkingLevel] {
    let list = efforts(caps?.supportedThinkingLevels)
    return caps?.alwaysThinks == true ? list : [.off] + list
}

/// The level `level` runs as: itself when offered, otherwise the nearest
/// offered level above it, otherwise the highest. Up first, because the rungs a
/// template or API lacks are usually folded into the next one (Opus 5.5's Off
/// is Low; Qwen 3.8's High is xhigh).
public func runsAs(_ level: ThinkingLevel, _ caps: ThinkingCaps?) -> ThinkingLevel {
    let offered = offeredLevels(caps)
    if offered.contains(level) { return level }
    return offered.first { $0.rawValue > level.rawValue } ?? offered[offered.count - 1]
}

/// A model with exactly one effort is an on/off switch (Qwen 3.5/3.6's
/// `enable_thinking`); calling that level Medium would imply a dial.
public func isSwitch(_ caps: ThinkingCaps?) -> Bool {
    Set((caps?.supportedThinkingLevels ?? []).filter { $0 != .off }).count == 1
}

/// The stable key for a level — the same words the web's dial uses.
public func levelKey(_ level: ThinkingLevel) -> String {
    switch level {
    case .off: return "off"
    case .low: return "low"
    case .medium: return "medium"
    case .high: return "high"
    case .max: return "max"
    default: return "level \(level.rawValue)"
    }
}

/// The label on the dial: a switch model's one effort reads "On".
public func levelLabel(_ level: ThinkingLevel, _ caps: ThinkingCaps?) -> String {
    if level != .off, isSwitch(caps) { return "On" }
    let key = levelKey(level)
    return key.prefix(1).uppercased() + key.dropFirst()
}

// MARK: ordering

private func compareText(_ a: String, _ b: String) -> Int {
    let x = a.lowercased()
    let y = b.lowercased()
    return x < y ? -1 : x > y ? 1 : 0
}

/// Newest release first; an unknown date sorts after every known one. Dates are
/// `yyyy-MM-dd`, so string order is date order.
private func compareNewest(_ a: String?, _ b: String?) -> Int {
    switch (a.truthy, b.truthy) {
    case (let a?, let b?): return a > b ? -1 : a < b ? 1 : 0
    case (_?, nil): return -1
    case (nil, _?): return 1
    case (nil, nil): return 0
    }
}

/// The picker's one order (`ModelOrdering.ByProviderTierNewest`): by provider,
/// then connection, then up the tier ladder, then newest first, then by name.
public func orderModels(_ models: [ModelCandidate]) -> [ModelCandidate] {
    func compare(_ a: ModelCandidate, _ b: ModelCandidate) -> Int {
        if a.kind != b.kind { return a.kind - b.kind }
        let byConnection = compareText(a.connectionName, b.connectionName)
        if byConnection != 0 { return byConnection }
        let byId = compareText(a.connectionId, b.connectionId)
        if byId != 0 { return byId }
        if a.tier != b.tier { return a.tier - b.tier }
        let byDate = compareNewest(a.releaseDate, b.releaseDate)
        if byDate != 0 { return byDate }
        return compareText(a.modelDisplayName, b.modelDisplayName)
    }
    return models.stableSorted { compare($0, $1) < 0 }
}

/// The candidate behind a selection, or nil. Matched on the connection as well
/// as the id when there is one: the same model can be listed by two connections,
/// and their thinking metadata need not agree.
public func findCandidate(_ models: [ModelCandidate], connectionId: String?, modelId: String?) -> ModelCandidate? {
    guard let modelId = modelId.truthy else { return nil }
    let id = modelId.lowercased()
    let sameId = models.filter { $0.modelId.lowercased() == id }
    if let connectionId = connectionId.truthy, let exact = sameId.first(where: { $0.connectionId == connectionId }) {
        return exact
    }
    return sameId.first
}
