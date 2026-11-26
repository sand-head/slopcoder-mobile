// What a prompt may carry, decided without a picker in the way.
//
// The limits are the server's: four images, two megabytes each after encoding,
// and only the formats the providers read. Checking here means the reason is
// said next to the composer rather than discovered as a rejected turn.

import Foundation

public enum ImageRules {
    public static let maxImages = 4
    public static let maxImageBytes = 2 * 1024 * 1024
    /// The longest edge an image is scaled to before it is encoded.
    public static let maxEdge = 1568

    /// How many bytes a base64 string decodes to, without decoding it.
    public static func decodedBytes(_ base64: String) -> Int {
        let padding = base64.hasSuffix("==") ? 2 : base64.hasSuffix("=") ? 1 : 0
        return base64.utf8.count * 3 / 4 - padding
    }

    /// The media type as the providers spell it, or nil for one they cannot read.
    public static func normalizeMediaType(_ type: String?) -> String? {
        let lower = (type ?? "").lowercased()
        if lower == "image/jpg" || lower == "image/jpeg" { return "image/jpeg" }
        if lower == "image/png" || lower == "image/gif" || lower == "image/webp" { return lower }
        return nil
    }

    public static let tooMany = "At most \(maxImages) images per prompt."

    /// Why an encoded image cannot ride a prompt, or nil when it can.
    public static func problem(name: String?, mediaType: String?, base64: String?) -> String? {
        let name = name.truthy ?? "That image"
        guard normalizeMediaType(mediaType) != nil else { return "\(name) is not an image the agent can read." }
        guard let base64, !base64.isEmpty else { return "\(name) could not be read." }
        if decodedBytes(base64) > maxImageBytes { return "\(name) is over 2 MB." }
        return nil
    }
}

/// An image waiting on the composer, keyed so a row can be removed.
public struct PendingImage: Hashable, Sendable, Identifiable {
    public var key: String
    public var mediaType: String
    public var base64Data: String

    public var id: String { key }

    public init(key: String, mediaType: String, base64Data: String) {
        self.key = key
        self.mediaType = mediaType
        self.base64Data = base64Data
    }

    public var attachment: ImageAttachment { ImageAttachment(mediaType: mediaType, base64Data: base64Data) }
}

/// `owner/name` out of a clone URL, for a chip.
public func shortRepo(_ url: String) -> String {
    var trimmed = url
    if trimmed.hasSuffix(".git") { trimmed = String(trimmed.dropLast(4)) }
    let parts = trimmed.split(separator: "/").map(String.init)
    let tail = parts.suffix(2).joined(separator: "/")
    return tail.isEmpty ? url : tail
}

/// What a turn runs as: the dials on the composer.
public struct TurnOptions: Hashable, Sendable {
    public var selection: ModelSelection
    public var thinking: ThinkingLevel?
    public var approval: ApprovalMode
    public var facet: String?

    public init(selection: ModelSelection = .autoRoute, thinking: ThinkingLevel? = nil, approval: ApprovalMode = .dangerous, facet: String? = nil) {
        self.selection = selection
        self.thinking = thinking
        self.approval = approval
        self.facet = facet
    }
}

public struct ApprovalChoice: Hashable, Sendable, Identifiable {
    public var key: String
    public var label: String
    public var description: String
    public var value: ApprovalMode
    public var id: String { key }

    public static let all: [ApprovalChoice] = [
        ApprovalChoice(key: "dangerous", label: "Dangerous only", description: "Asks only for what the classifier escalates", value: .dangerous),
        ApprovalChoice(key: "auto", label: "Never ask", description: "Nothing will block waiting for you", value: .auto),
        ApprovalChoice(key: "always", label: "Always ask", description: "Every tool call waits", value: .always),
    ]

    public static func label(for mode: ApprovalMode) -> String {
        all.first { $0.value == mode }?.label ?? ""
    }

    public init(key: String, label: String, description: String, value: ApprovalMode) {
        self.key = key
        self.label = label
        self.description = description
        self.value = value
    }
}
