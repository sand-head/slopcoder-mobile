import Foundation

/// A JSON object that remembers the order its keys arrived in.
///
/// The order is not decoration. A tool call's one-line summary is "the first
/// string in its input", and a card lists a payload's fields the way the server
/// wrote them — so a dictionary's arbitrary order would reshuffle the
/// transcript on every launch.
public struct JSONObject: Hashable, Sendable {
    public private(set) var keys: [String] = []
    private var storage: [String: JSONValue] = [:]

    public init() {}

    public init(_ pairs: [(String, JSONValue)]) {
        for (key, value) in pairs { self[key] = value }
    }

    public subscript(key: String) -> JSONValue? {
        get { storage[key] }
        set {
            if let newValue {
                // A repeated key keeps its first position and takes the last value,
                // as `JSON.parse` does.
                if storage.updateValue(newValue, forKey: key) == nil { keys.append(key) }
            } else if storage.removeValue(forKey: key) != nil {
                keys.removeAll { $0 == key }
            }
        }
    }

    /// From an unordered dictionary: keys sorted, so the result is at least stable.
    public init(_ dictionary: [String: JSONValue]) {
        for key in dictionary.keys.sorted() { self[key] = dictionary[key] }
    }

    public var count: Int { keys.count }
    public var isEmpty: Bool { keys.isEmpty }

    /// Two objects are equal when they hold the same members, in any order —
    /// order is how one is *read*, not what it *is*.
    public static func == (left: JSONObject, right: JSONObject) -> Bool { left.storage == right.storage }
    public func hash(into hasher: inout Hasher) { hasher.combine(storage) }

    /// Values in arrival order — `Object.values`.
    public var values: [JSONValue] { keys.map { storage[$0]! } }

    /// Pairs in arrival order — `Object.entries`.
    public var entries: [(key: String, value: JSONValue)] { keys.map { ($0, storage[$0]!) } }
}

extension JSONObject: ExpressibleByDictionaryLiteral {
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        self.init(elements)
    }
}

/// A JSON document held as a value.
///
/// Transcript events arrive as `payloadJson` — a string to parse a second time —
/// and their shapes are the server's C# records, read here by key rather than
/// through one struct per event kind. That keeps a field the app does not know
/// about from failing a decode, which matters because scrollback outlives the
/// build that wrote it.
public enum JSONValue: Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object(JSONObject)

    // MARK: parsing

    /// Nil when the text is not JSON at all. Strict, like `JSON.parse`.
    public static func parse(_ text: String) -> JSONValue? {
        var parser = JSONParser(bytes: Array(text.utf8))
        return parser.parseDocument()
    }

    public static func parse(_ data: Data) -> JSONValue? {
        var parser = JSONParser(bytes: Array(data))
        return parser.parseDocument()
    }

    // MARK: reading

    public subscript(key: String) -> JSONValue {
        if case .object(let object) = self { return object[key] ?? .null }
        return .null
    }

    public subscript(index: Int) -> JSONValue {
        if case .array(let array) = self, array.indices.contains(index) { return array[index] }
        return .null
    }

    /// True when the key is present at all, null included.
    public func has(_ key: String) -> Bool {
        if case .object(let object) = self { return object[key] != nil }
        return false
    }

    public var isNull: Bool {
        if case .null = self { return true }
        return false
    }

    public var string: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    public var bool: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    public var double: Double? {
        if case .number(let value) = self { return value }
        return nil
    }

    public var int: Int? {
        if case .number(let value) = self, value.isFinite, abs(value) < 9.0e18 { return Int(value) }
        return nil
    }

    public var array: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }

    public var object: JSONObject? {
        if case .object(let value) = self { return value }
        return nil
    }

    /// The string, or `""`: what `value ?? ''` reads as.
    public var stringValue: String { string ?? "" }
    public var boolValue: Bool { bool ?? false }
    public var intValue: Int { int ?? 0 }
    public var arrayValue: [JSONValue] { array ?? [] }
    public var objectValue: JSONObject { object ?? JSONObject() }

    /// JavaScript's truthiness, which the transcript folding leans on in places.
    public var truthy: Bool {
        switch self {
        case .null: return false
        case .bool(let value): return value
        case .number(let value): return value != 0 && !value.isNaN
        case .string(let value): return !value.isEmpty
        case .array, .object: return true
        }
    }

    /// What a JavaScript template literal would print for this value.
    public var display: String {
        switch self {
        case .null: return "null"
        case .bool(let value): return value ? "true" : "false"
        case .number(let value): return JSONValue.format(value)
        case .string(let value): return value
        case .array(let value): return value.map(\.display).joined(separator: ",")
        case .object: return "[object Object]"
        }
    }

    // MARK: writing

    static func format(_ value: Double) -> String {
        if !value.isFinite { return "null" }
        if value == value.rounded() {
            if abs(value) < 1.0e15 { return String(Int64(value)) }
            // JavaScript writes integers out in full up to 1e21.
            if abs(value) < 1.0e21 { return String(format: "%.0f", value) }
        }
        return "\(value)"
    }

    /// `JSON.stringify(value)`, or with `pretty` `JSON.stringify(value, null, 2)`:
    /// keys in arrival order either way.
    public func serialized(pretty: Bool = false) -> String {
        var out = ""
        write(into: &out, pretty: pretty, depth: 0)
        return out
    }

    private func write(into out: inout String, pretty: Bool, depth: Int) {
        switch self {
        case .null: out += "null"
        case .bool(let value): out += value ? "true" : "false"
        case .number(let value): out += JSONValue.format(value)
        case .string(let value): JSONValue.writeString(value, into: &out)
        case .array(let items):
            if items.isEmpty { out += "[]"; return }
            out += "["
            for (index, item) in items.enumerated() {
                if index > 0 { out += "," }
                if pretty { out += "\n" + String(repeating: "  ", count: depth + 1) }
                item.write(into: &out, pretty: pretty, depth: depth + 1)
            }
            if pretty { out += "\n" + String(repeating: "  ", count: depth) }
            out += "]"
        case .object(let object):
            if object.isEmpty { out += "{}"; return }
            out += "{"
            for (index, entry) in object.entries.enumerated() {
                if index > 0 { out += "," }
                if pretty { out += "\n" + String(repeating: "  ", count: depth + 1) }
                JSONValue.writeString(entry.key, into: &out)
                out += pretty ? ": " : ":"
                entry.value.write(into: &out, pretty: pretty, depth: depth + 1)
            }
            if pretty { out += "\n" + String(repeating: "  ", count: depth) }
            out += "}"
        }
    }

    static func writeString(_ value: String, into out: inout String) {
        out += "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
    }

    /// Reads this value as a `Decodable`, or nil when it does not fit.
    public func decoded<T: Decodable>(_ type: T.Type = T.self) -> T? {
        try? JSONDecoder().decode(T.self, from: Data(serialized().utf8))
    }
}

/// A strict recursive-descent JSON parser over UTF-8 that keeps object key order.
private struct JSONParser {
    let bytes: [UInt8]
    var index = 0
    var depth = 0

    init(bytes: [UInt8]) { self.bytes = bytes }

    mutating func parseDocument() -> JSONValue? {
        skipWhitespace()
        guard let value = parseValue() else { return nil }
        skipWhitespace()
        return index == bytes.count ? value : nil
    }

    private mutating func skipWhitespace() {
        while index < bytes.count {
            switch bytes[index] {
            case 0x20, 0x09, 0x0A, 0x0D: index += 1
            default: return
            }
        }
    }

    private mutating func parseValue() -> JSONValue? {
        guard index < bytes.count else { return nil }
        switch bytes[index] {
        case UInt8(ascii: "{"): return parseObject()
        case UInt8(ascii: "["): return parseArray()
        case UInt8(ascii: "\""): return parseString().map(JSONValue.string)
        case UInt8(ascii: "t"): return literal("true", .bool(true))
        case UInt8(ascii: "f"): return literal("false", .bool(false))
        case UInt8(ascii: "n"): return literal("null", .null)
        default: return parseNumber()
        }
    }

    private mutating func literal(_ word: String, _ value: JSONValue) -> JSONValue? {
        let expected = Array(word.utf8)
        guard index + expected.count <= bytes.count, Array(bytes[index..<index + expected.count]) == expected else { return nil }
        index += expected.count
        return value
    }

    private mutating func parseNumber() -> JSONValue? {
        let start = index
        if index < bytes.count, bytes[index] == UInt8(ascii: "-") { index += 1 }
        let digitsStart = index
        while index < bytes.count, (0x30...0x39).contains(bytes[index]) { index += 1 }
        guard index > digitsStart else { return nil }
        // No leading zeros, as the grammar says.
        if index - digitsStart > 1, bytes[digitsStart] == 0x30 { return nil }
        if index < bytes.count, bytes[index] == UInt8(ascii: ".") {
            index += 1
            let fraction = index
            while index < bytes.count, (0x30...0x39).contains(bytes[index]) { index += 1 }
            guard index > fraction else { return nil }
        }
        if index < bytes.count, bytes[index] == UInt8(ascii: "e") || bytes[index] == UInt8(ascii: "E") {
            index += 1
            if index < bytes.count, bytes[index] == UInt8(ascii: "+") || bytes[index] == UInt8(ascii: "-") { index += 1 }
            let exponent = index
            while index < bytes.count, (0x30...0x39).contains(bytes[index]) { index += 1 }
            guard index > exponent else { return nil }
        }
        guard let value = Double(String(decoding: bytes[start..<index], as: UTF8.self)) else { return nil }
        return .number(value)
    }

    private mutating func parseString() -> String? {
        index += 1 // opening quote
        var scalars = String.UnicodeScalarView()
        var run = index
        func flush(_ scalars: inout String.UnicodeScalarView, _ from: Int, _ to: Int) {
            if to > from { scalars.append(contentsOf: String(decoding: bytes[from..<to], as: UTF8.self).unicodeScalars) }
        }
        while index < bytes.count {
            let byte = bytes[index]
            if byte == UInt8(ascii: "\"") {
                flush(&scalars, run, index)
                index += 1
                return String(scalars)
            }
            if byte < 0x20 { return nil }
            if byte != UInt8(ascii: "\\") {
                index += 1
                continue
            }
            flush(&scalars, run, index)
            index += 1
            guard index < bytes.count else { return nil }
            let escape = bytes[index]
            index += 1
            switch escape {
            case UInt8(ascii: "\""): scalars.append("\"")
            case UInt8(ascii: "\\"): scalars.append("\\")
            case UInt8(ascii: "/"): scalars.append("/")
            case UInt8(ascii: "b"): scalars.append("\u{08}")
            case UInt8(ascii: "f"): scalars.append("\u{0C}")
            case UInt8(ascii: "n"): scalars.append("\n")
            case UInt8(ascii: "r"): scalars.append("\r")
            case UInt8(ascii: "t"): scalars.append("\t")
            case UInt8(ascii: "u"):
                guard var unit = hex4() else { return nil }
                if (0xD800...0xDBFF).contains(unit),
                   index + 1 < bytes.count, bytes[index] == UInt8(ascii: "\\"), bytes[index + 1] == UInt8(ascii: "u") {
                    let saved = index
                    index += 2
                    if let low = hex4(), (0xDC00...0xDFFF).contains(low) {
                        unit = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
                    } else {
                        index = saved
                    }
                }
                // A lone surrogate has no scalar; U+FFFD stands in for it.
                scalars.append(Unicode.Scalar(unit) ?? "\u{FFFD}")
            default: return nil
            }
            run = index
        }
        return nil
    }

    private mutating func hex4() -> UInt32? {
        guard index + 4 <= bytes.count else { return nil }
        var value: UInt32 = 0
        for offset in 0..<4 {
            let byte = bytes[index + offset]
            let digit: UInt32
            switch byte {
            case 0x30...0x39: digit = UInt32(byte - 0x30)
            case 0x41...0x46: digit = UInt32(byte - 0x41 + 10)
            case 0x61...0x66: digit = UInt32(byte - 0x61 + 10)
            default: return nil
            }
            value = value << 4 | digit
        }
        index += 4
        return value
    }

    private mutating func parseArray() -> JSONValue? {
        guard depth < 256 else { return nil }
        depth += 1
        defer { depth -= 1 }
        index += 1
        var items: [JSONValue] = []
        skipWhitespace()
        if index < bytes.count, bytes[index] == UInt8(ascii: "]") {
            index += 1
            return .array(items)
        }
        while true {
            skipWhitespace()
            guard let value = parseValue() else { return nil }
            items.append(value)
            skipWhitespace()
            guard index < bytes.count else { return nil }
            if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
            if bytes[index] == UInt8(ascii: "]") { index += 1; return .array(items) }
            return nil
        }
    }

    private mutating func parseObject() -> JSONValue? {
        guard depth < 256 else { return nil }
        depth += 1
        defer { depth -= 1 }
        index += 1
        var object = JSONObject()
        skipWhitespace()
        if index < bytes.count, bytes[index] == UInt8(ascii: "}") {
            index += 1
            return .object(object)
        }
        while true {
            skipWhitespace()
            guard index < bytes.count, bytes[index] == UInt8(ascii: "\""), let key = parseString() else { return nil }
            skipWhitespace()
            guard index < bytes.count, bytes[index] == UInt8(ascii: ":") else { return nil }
            index += 1
            skipWhitespace()
            guard let value = parseValue() else { return nil }
            object[key] = value
            skipWhitespace()
            guard index < bytes.count else { return nil }
            if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
            if bytes[index] == UInt8(ascii: "}") { index += 1; return .object(object) }
            return nil
        }
    }
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            // A keyed container has no order to offer; documents whose order
            // matters are read with `JSONValue.parse` instead.
            let pairs = try container.decode([String: JSONValue].self)
            self = .object(JSONObject(pairs.keys.sorted().map { ($0, pairs[$0]!) }))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value):
            if value.isFinite, value == value.rounded(), abs(value) < 1.0e15 {
                try container.encode(Int64(value))
            } else {
                try container.encode(value)
            }
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value):
            var keyed = encoder.container(keyedBy: AnyCodingKey.self)
            for entry in value.entries { try keyed.encode(entry.value, forKey: AnyCodingKey(entry.key)) }
        }
    }
}

// No `ExpressibleByNilLiteral`: it would make `parse(text) == nil` compare
// against `.null` and quietly answer the wrong question.
extension JSONValue: ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByStringLiteral, ExpressibleByArrayLiteral,
    ExpressibleByDictionaryLiteral {
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(stringLiteral value: String) { self = .string(value) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        self = .object(JSONObject(elements))
    }
}

struct AnyCodingKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(_ string: String) { stringValue = string }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

extension KeyedDecodingContainer {
    /// A field that is absent, null, or the wrong shape reads as nil rather than
    /// failing the whole document.
    public func lenient<T: Decodable>(_ key: Key) -> T? {
        if let value = try? decodeIfPresent(T.self, forKey: key) { return value }
        return nil
    }

    /// Integers are lenient about `3.0`, which a JavaScript-fed server can emit.
    public func lenient(_ key: Key) -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Double.self, forKey: key), value.isFinite { return Int(value) }
        return nil
    }
}

/// The encoder and decoder every seam call shares. Property names are already
/// camelCase on both sides, so neither needs a key strategy.
public enum Wire {
    public static func decode<T: Decodable>(_ type: T.Type = T.self, from data: Data) throws -> T {
        try JSONDecoder().decode(T.self, from: data)
    }

    public static func decode<T: Decodable>(_ type: T.Type = T.self, from text: String) -> T? {
        try? JSONDecoder().decode(T.self, from: Data(text.utf8))
    }

    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return try encoder.encode(value)
    }
}
