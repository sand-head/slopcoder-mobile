// The arithmetic behind the transcript's list: where each row sits, whether
// the reader is at the end, where to put them back after the rows above them
// change, and which rows have to be drawn again.
//
// None of it can be watched from here — there is no screen — so all of it is
// kept out of UIKit, where a test can hold it. The list view only measures rows
// and does what this says.

import Foundation

/// What the list holds: the spinner above the history, the rows, and the
/// streaming tail below them.
public enum TranscriptEntry: Hashable, Sendable {
    case earlier
    case row(String)
    case live
}

/// The rows stacked top to bottom, with exact heights: no row's place is a guess.
public struct TranscriptStack: Equatable, Sendable {
    public private(set) var heights: [Double]
    public let spacing: Double
    /// Above the first row and below the last.
    public let padding: Double
    public private(set) var tops: [Double]

    public init(heights: [Double], spacing: Double, padding: Double) {
        self.heights = heights
        self.spacing = spacing
        self.padding = padding
        var tops: [Double] = []
        tops.reserveCapacity(heights.count)
        var y = padding
        for height in heights {
            tops.append(y)
            y += height + spacing
        }
        self.tops = tops
    }

    public var count: Int { heights.count }

    public var contentHeight: Double {
        guard let last = heights.indices.last else { return padding * 2 }
        return tops[last] + heights[last] + padding
    }

    public func bottom(_ index: Int) -> Double { tops[index] + heights[index] }

    /// The first row any of which is below `y`.
    public func first(endingBelow y: Double) -> Int? {
        var low = 0
        var high = count
        while low < high {
            let mid = (low + high) / 2
            if bottom(mid) > y { high = mid } else { low = mid + 1 }
        }
        return low < count ? low : nil
    }

    /// The rows that overlap `minY..<maxY`.
    public func indices(overlapping minY: Double, _ maxY: Double) -> Range<Int> {
        guard let start = first(endingBelow: minY) else { return count..<count }
        var end = start
        while end < count, tops[end] < maxY { end += 1 }
        return start..<end
    }
}

/// The reading column across a list that runs edge to edge: inside the safe
/// area, held to a measure, centred, with room either side.
public enum ReadingColumn {
    /// `left` and `right` are the safe area's, in screen terms (not leading and
    /// trailing). The measure includes the padding, as `readingWidth()` does.
    public static func frame(width: Double, left: Double, right: Double, padding: Double, maxWidth: Double) -> (x: Double, width: Double) {
        let available = max(0, width - left - right)
        let measure = min(available, maxWidth)
        let x = left + (available - measure) / 2 + padding
        return (x, max(0, measure - padding * 2))
    }
}

/// A vertical scroll view at one moment, in the scroll view's own terms: an
/// offset of `-insetTop` is the top of the content.
public struct ScrollViewport: Equatable, Sendable {
    public var offset: Double
    public var height: Double
    public var insetTop: Double
    public var insetBottom: Double
    public var contentHeight: Double

    public init(offset: Double, height: Double, insetTop: Double, insetBottom: Double, contentHeight: Double) {
        self.offset = offset
        self.height = height
        self.insetTop = insetTop
        self.insetBottom = insetBottom
        self.contentHeight = contentHeight
    }

    public var minOffset: Double { -insetTop }
    /// Where the last line sits just above whatever floats over the bottom. A
    /// transcript shorter than the window ends where it starts.
    public var maxOffset: Double { max(minOffset, contentHeight + insetBottom - height) }
    public var visibleTop: Double { offset + insetTop }
    public var visibleHeight: Double { max(0, height - insetTop - insetBottom) }

    public func clamped(_ offset: Double) -> Double { min(max(offset, minOffset), maxOffset) }

    public func isAtEnd(tolerance: Double = TranscriptScroll.endTolerance) -> Bool {
        offset >= maxOffset - tolerance
    }

    public var distanceFromTop: Double { offset - minOffset }
}

/// A row and how far its top is below the top of what can be seen. Negative
/// when the row starts above it.
public struct ScrollAnchor: Equatable, Sendable {
    public var entry: TranscriptEntry
    public var distance: Double

    public init(entry: TranscriptEntry, distance: Double) {
        self.entry = entry
        self.distance = distance
    }
}

public enum TranscriptScroll {
    /// How near the end still counts as at it. A finger lifts a point or two
    /// short; the end is where the reader meant to be.
    public static let endTolerance: Double = 8

    /// The row at the top of what the reader can see: the one to hold still
    /// when anything above or around it changes.
    public static func anchor(_ entries: [TranscriptEntry], _ stack: TranscriptStack, _ viewport: ScrollViewport) -> ScrollAnchor? {
        guard entries.count == stack.count, let index = stack.first(endingBelow: viewport.visibleTop) else { return nil }
        return ScrollAnchor(entry: entries[index], distance: stack.tops[index] - viewport.visibleTop)
    }

    /// Where the list goes after its rows, their heights, the width or the
    /// insets change.
    ///
    /// Following, it goes to the end. Otherwise the anchor row stays where it
    /// was on the screen — so a page of history arriving above, or a row above
    /// growing, moves nothing the reader is looking at — and anything that came
    /// up from the bottom (the keyboard, a taller composer) pushes the content
    /// up with it rather than covering it.
    public static func offset(
        following: Bool,
        anchor: ScrollAnchor?,
        entries: [TranscriptEntry],
        stack: TranscriptStack,
        before: ScrollViewport,
        after: ScrollViewport
    ) -> Double {
        if following { return after.maxOffset }
        var offset = after.offset
        if let anchor, let index = entries.firstIndex(of: anchor.entry), index < stack.count {
            offset = stack.tops[index] - anchor.distance - after.insetTop
        }
        offset += after.insetBottom - before.insetBottom
        return after.clamped(offset)
    }

    /// An offset that puts a row in the middle of what can be seen, or as near
    /// as the ends allow.
    public static func centring(_ index: Int, _ stack: TranscriptStack, _ viewport: ScrollViewport) -> Double {
        let middle = stack.tops[index] + stack.heights[index] / 2
        return viewport.clamped(middle - viewport.insetTop - viewport.visibleHeight / 2)
    }

    /// Whether to ask for the page before this one: within a screen of the top,
    /// so it has usually arrived before the reader gets there.
    public static func nearTop(_ viewport: ScrollViewport) -> Bool {
        viewport.distanceFromTop < max(viewport.visibleHeight, 1)
    }
}

/// Measured heights, kept per width so that folding and unfolding a Duo, or
/// turning a phone and back, does not measure every row again.
public struct HeightCache: Sendable {
    /// How many widths to remember. Two is a fold; one more is a rotation.
    public let widths: Int
    private var byWidth: [Double: [TranscriptEntry: Double]] = [:]
    /// Most recently used last.
    private var order: [Double] = []

    public init(widths: Int = 3) {
        self.widths = max(1, widths)
    }

    public func height(_ entry: TranscriptEntry, width: Double) -> Double? {
        byWidth[width]?[entry]
    }

    public mutating func set(_ entry: TranscriptEntry, width: Double, height: Double) {
        if byWidth[width] == nil {
            byWidth[width] = [:]
            order.append(width)
            while order.count > widths { byWidth[order.removeFirst()] = nil }
        } else if order.last != width {
            order.removeAll { $0 == width }
            order.append(width)
        }
        byWidth[width]![entry] = height
    }

    /// Forget a row at every width: what it draws has changed, so what was
    /// measured at another width is wrong there too.
    public mutating func invalidate(_ entry: TranscriptEntry) {
        for width in order { byWidth[width]?[entry] = nil }
    }

    public mutating func removeAll() {
        byWidth = [:]
        order = []
    }
}

/// What a row reads from the session around it, beyond its own data. Changes
/// to these redraw only the rows that read them.
public struct RowCircumstances: Equatable, Sendable {
    public var parentDriven: Bool
    public var roster: [SubSessionInfo]
    public var mentions: [SubSessionMention]
    public var pendingApprovals: [String]
    public var pendingQuestions: [String]

    public init(
        parentDriven: Bool = false,
        roster: [SubSessionInfo] = [],
        mentions: [SubSessionMention] = [],
        pendingApprovals: [String] = [],
        pendingQuestions: [String] = []
    ) {
        self.parentDriven = parentDriven
        self.roster = roster
        self.mentions = mentions
        self.pendingApprovals = pendingApprovals
        self.pendingQuestions = pendingQuestions
    }
}

public struct RowReads: OptionSet, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let parentDriven = RowReads(rawValue: 1)
    public static let roster = RowReads(rawValue: 2)
    public static let mentions = RowReads(rawValue: 4)
    public static let approvals = RowReads(rawValue: 8)
    public static let questions = RowReads(rawValue: 16)

    /// The parts of the circumstances that differ between two.
    public static func changed(_ a: RowCircumstances, _ b: RowCircumstances) -> RowReads {
        var changed: RowReads = []
        if a.parentDriven != b.parentDriven { changed.insert(.parentDriven) }
        if a.roster != b.roster { changed.insert(.roster) }
        if a.mentions != b.mentions { changed.insert(.mentions) }
        if a.pendingApprovals != b.pendingApprovals { changed.insert(.approvals) }
        if a.pendingQuestions != b.pendingQuestions { changed.insert(.questions) }
        return changed
    }
}

extension Item {
    /// Mirrors `TranscriptRow` in the app: a user bubble says who sent it, prose
    /// tints partner names, the cards ask whether they are still pending, and a
    /// sub-session card shows the roster's figures. Anything else reads nothing.
    public var reads: RowReads {
        switch body {
        case .user: return .parentDriven
        case .text: return .mentions
        case .approval: return .approvals
        case .question: return .questions
        case .subsession: return .roster
        default: return []
        }
    }
}

extension DisplayRow {
    public var reads: RowReads {
        switch self {
        case .item(let item): return item.reads
        case .subagent(let group): return group.items.reduce(into: []) { $0.formUnion($1.reads) }
        case .toolRun(let run): return run.tools.reduce(into: []) { $0.formUnion($1.reads) }
        case .dateMarker: return []
        }
    }
}

public struct RowChanges: Equatable, Sendable {
    /// Rows in both lists that must be drawn again, in the new list's order.
    public var changed: [String]
    /// Rows no longer in the list.
    public var removed: [String]

    public init(changed: [String] = [], removed: [String] = []) {
        self.changed = changed
        self.removed = removed
    }
}

public enum TranscriptChanges {
    /// The rows with one entry per id. Two rows with one id would bring a
    /// diffable list down; the first is kept, as a `ForEach` would show it.
    public static func unique(_ rows: [DisplayRow]) -> [DisplayRow] {
        var seen = Set<String>()
        return rows.filter { seen.insert($0.id).inserted }
    }

    /// What has to be redrawn going from one list to the next: a row whose own
    /// data changed, or that reads a part of the circumstances that did. The
    /// same row in the same circumstances is left alone.
    public static func between(
        _ old: [DisplayRow], _ new: [DisplayRow],
        before: RowCircumstances, after: RowCircumstances
    ) -> RowChanges {
        let circumstances = RowReads.changed(before, after)
        var previous: [String: DisplayRow] = [:]
        for row in old where previous[row.id] == nil { previous[row.id] = row }
        var present = Set<String>()
        var changed: [String] = []
        for row in new where present.insert(row.id).inserted {
            guard let was = previous[row.id] else { continue }
            if was != row || !row.reads.intersection(circumstances).isEmpty { changed.append(row.id) }
        }
        let removed = previous.keys.filter { !present.contains($0) }.sorted()
        return RowChanges(changed: changed, removed: removed)
    }
}
