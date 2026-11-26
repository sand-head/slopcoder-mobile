import Foundation
import Testing
@testable import SlopcoderCore

@Suite struct JSONValueTests {
    @Test func tellsBooleansFromNumbers() {
        let value = JSONValue.parse(#"{"a":true,"b":1,"c":0,"d":false,"e":1.5,"f":null,"g":"x"}"#)!
        #expect(value["a"] == .bool(true))
        #expect(value["b"] == .number(1))
        #expect(value["c"] == .number(0))
        #expect(value["d"] == .bool(false))
        #expect(value["e"].double == 1.5)
        #expect(value["f"].isNull)
        #expect(value["g"].string == "x")
        #expect(value["missing"]["deeper"].isNull)
    }

    @Test func enumsTravelAsIntegersAndSurviveUnknownMembers() throws {
        let state = try Wire.decode(SessionSummary.self, from: Data(#"{"id":"a","title":"t","status":1}"#.utf8))
        #expect(state.status == .running)
        #expect(state.model == "")
        let odd = try Wire.decode(SessionSummary.self, from: Data(#"{"id":"a","status":42}"#.utf8))
        #expect(odd.status.rawValue == 42)
        let text = String(decoding: try Wire.encode(SetApprovalRequest(mode: .always, useClassifier: true)), as: UTF8.self)
        #expect(text.contains(#""mode":2"#))
    }
}

@Suite struct JSONOrderTests {
    /// A tool's one-line summary is the first string in its input, so the order
    /// the server wrote must be the order read back.
    @Test func keepsKeysInTheOrderTheyArrived() {
        let value = JSONValue.parse(#"{"zeta":1,"alpha":"a","mid":[true,null],"alpha2":{"y":1,"x":2}}"#)!
        #expect(value.objectValue.keys == ["zeta", "alpha", "mid", "alpha2"])
        #expect(value.serialized() == #"{"zeta":1,"alpha":"a","mid":[true,null],"alpha2":{"y":1,"x":2}}"#)
    }

    @Test func prettyPrintsTheWayJSONStringifyDoes() {
        let value = JSONValue.parse(#"{"b":[1,2.5,"x"],"a":{},"c":[]}"#)!
        #expect(value.serialized(pretty: true) == "{\n  \"b\": [\n    1,\n    2.5,\n    \"x\"\n  ],\n  \"a\": {},\n  \"c\": []\n}")
    }

    @Test func readsEscapesAndSurrogatePairs() {
        let value = JSONValue.parse(#"["a\nb","é","👍","q\"uote\\"]"#)!
        #expect(value[0].string == "a\nb")
        #expect(value[1].string == "é")
        #expect(value[2].string == "👍")
        #expect(value[3].string == "q\"uote\\")
        #expect(JSONValue.string("a\n\"b\"\\\u{01}").serialized() == #""a\n\"b\"\\\u0001""#)
    }

    @Test func isAsStrictAsJSONParse() {
        for bad in ["", "{", "[1,]", "{\"a\":1,}", "01", "1.", "nul", "\"a", "{\"a\" 1}", "1 2", "'a'", "{a:1}"] {
            #expect(JSONValue.parse(bad) == nil, "accepted: \(bad)")
        }
        #expect(JSONValue.parse(" [ 1 , -2.5e3 , 0 ] ") == [1, -2500, 0])
        #expect(JSONValue.parse("\"plain\"") == "plain")
    }
}
