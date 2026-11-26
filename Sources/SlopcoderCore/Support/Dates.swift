import Foundation

/// Timestamps as the server writes them: ISO 8601, with or without fractional
/// seconds, with an offset or `Z` — and `DateOnly`, a bare `yyyy-MM-dd`.
public enum WireDate {
    /// Nil for anything that is not a date, which is what `Date.parse` answering
    /// `NaN` was used to detect.
    public static func parse(_ text: String?) -> Date? {
        guard let text, !text.isEmpty else { return nil }
        if let date = parseISO(text) { return date }
        return nil
    }

    private static func parseISO(_ text: String) -> Date? {
        // Hand-rolled rather than `ISO8601DateFormatter`: .NET writes seven
        // fractional digits, the formatter accepts exactly three or none, and it
        // is not `Sendable` besides.
        let scalars = Array(text.unicodeScalars)
        var index = 0

        func digits(_ count: Int) -> Int? {
            guard index + count <= scalars.count else { return nil }
            var value = 0
            for offset in 0..<count {
                let scalar = scalars[index + offset].value
                guard (0x30...0x39).contains(scalar) else { return nil }
                value = value * 10 + Int(scalar - 0x30)
            }
            index += count
            return value
        }

        func eat(_ character: Unicode.Scalar) -> Bool {
            if index < scalars.count, scalars[index] == character {
                index += 1
                return true
            }
            return false
        }

        guard let year = digits(4), eat("-"), let month = digits(2), eat("-"), let day = digits(2) else { return nil }
        var hour = 0, minute = 0, second = 0
        var fraction = 0.0
        var offsetSeconds: Int? = nil
        var hasTime = false

        if index < scalars.count, scalars[index] == "T" || scalars[index] == " " || scalars[index] == "t" {
            index += 1
            hasTime = true
            guard let h = digits(2), eat(":"), let m = digits(2) else { return nil }
            hour = h
            minute = m
            if eat(":") {
                guard let s = digits(2) else { return nil }
                second = s
                if eat(".") || eat(",") {
                    var scale = 0.1
                    var any = false
                    while index < scalars.count, (0x30...0x39).contains(scalars[index].value) {
                        fraction += Double(scalars[index].value - 0x30) * scale
                        scale /= 10
                        index += 1
                        any = true
                    }
                    guard any else { return nil }
                }
            }
            if eat("Z") || eat("z") {
                offsetSeconds = 0
            } else if index < scalars.count, scalars[index] == "+" || scalars[index] == "-" {
                let sign = scalars[index] == "-" ? -1 : 1
                index += 1
                guard let oh = digits(2) else { return nil }
                _ = eat(":")
                let om = digits(2) ?? 0
                offsetSeconds = sign * (oh * 3600 + om * 60)
            }
        }
        guard index == scalars.count else { return nil }
        guard (1...12).contains(month), (1...31).contains(day), hour < 25, minute < 60, second < 61 else { return nil }

        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute
        components.second = second
        var calendar = Calendar(identifier: .gregorian)
        // A date with no time is UTC midnight and a time with no zone is local,
        // which is how JavaScript read them and so what the screens were built on.
        if let offsetSeconds {
            calendar.timeZone = TimeZone(secondsFromGMT: offsetSeconds) ?? .gmt
        } else if !hasTime {
            calendar.timeZone = .gmt
        } else {
            calendar.timeZone = .current
        }
        guard let date = calendar.date(from: components) else { return nil }
        return date.addingTimeInterval(fraction)
    }

    public static func isValid(_ text: String?) -> Bool { parse(text) != nil }
}

extension String {
    /// JavaScript's `length`: UTF-16 code units.
    var jsLength: Int { utf16.count }

    /// Runs of whitespace collapsed to one space, ends trimmed.
    var collapsingWhitespace: String {
        split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

/// The clock and the conventions a time is worded on. The app's is the phone's
/// own; tests pin one so "today" does not depend on when they run.
public struct TimeContext: Sendable {
    public var now: Date
    public var calendar: Calendar
    public var locale: Locale

    public init(now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) {
        self.now = now
        self.calendar = calendar
        self.locale = locale
    }

    public static var current: TimeContext { TimeContext() }

    /// A fixed moment in a named zone, for tests and previews.
    public static func fixed(_ iso: String, zone: String = "UTC", locale: String = "en_US") -> TimeContext {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone) ?? .gmt
        calendar.locale = Locale(identifier: locale)
        return TimeContext(now: WireDate.parse(iso) ?? Date(timeIntervalSince1970: 0), calendar: calendar, locale: Locale(identifier: locale))
    }

    public var nowMs: Double { now.timeIntervalSince1970 * 1000 }

    func startOfDay(_ date: Date) -> Date { calendar.startOfDay(for: date) }

    func format(_ date: Date, pattern: String) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }

    func format(_ date: Date, template: String) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }
}

/// `Number.prototype.toFixed`: the exact binary value rounded half *up*, where
/// `String(format:)` rounds half to even. They part ways only on exact ties
/// (1.25 → "1.3", not "1.2"), which is precisely where two clients showing the
/// same duration would otherwise disagree.
public func jsToFixed(_ value: Double, _ digits: Int) -> String {
    guard value.isFinite else { return "NaN" }
    let doubled = value * Double(1 << (digits + 1))
    if doubled == doubled.rounded(), abs(doubled) < 1.0e15, Int64(abs(doubled)) % 2 == 1 {
        let scale = pow(10.0, Double(digits))
        let rounded = (value * scale + 0.5).rounded(.down)
        return String(format: "%.\(digits)f", rounded / scale)
    }
    return String(format: "%.\(digits)f", value)
}

extension Sequence {
    /// A sort that keeps equal elements in the order they came, as JavaScript's
    /// does. The standard library's happens to, and does not promise to.
    func stableSorted(by areInIncreasingOrder: (Element, Element) -> Bool) -> [Element] {
        enumerated().sorted { left, right in
            if areInIncreasingOrder(left.element, right.element) { return true }
            if areInIncreasingOrder(right.element, left.element) { return false }
            return left.offset < right.offset
        }.map(\.element)
    }
}
