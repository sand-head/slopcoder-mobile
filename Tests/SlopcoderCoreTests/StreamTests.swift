// The reassembly rules. Every case here is one the server can actually produce,
// and getting any of them wrong shows up as a transcript that is quietly missing
// something rather than as an error.

import Foundation
import Testing
@testable import SlopcoderCore

func envelope(_ ordinal: Int, kind: String = "AssistantText") -> AgentEventEnvelope {
    AgentEventEnvelope(ordinal: ordinal, kind: kind, payloadJson: "{\"text\":\"#\(ordinal)\"}")
}

private func state(_ nextOrdinal: Int) -> SessionState {
    SessionState(nextOrdinal: nextOrdinal)
}

private func patch(_ from: Int, _ append: String) -> LivePatch {
    LivePatch(thinkingFrom: 0, thinkingAppend: "", textFrom: from, textAppend: append)
}

@Suite struct SessionStreamTests {
    @Test func appendsEventsThatFollowTheCursor() {
        var stream = SessionStream()
        stream.seed(from: 0, events: [envelope(0), envelope(1)])
        let outcome = stream.apply(state: state(3), incoming: [envelope(2)])
        #expect(stream.nextOrdinal == 3)
        #expect(outcome.needsPull == false)
    }

    @Test func skipsADuplicateRatherThanStoringItTwice() {
        var stream = SessionStream()
        stream.seed(from: 0, events: [envelope(0), envelope(1)])
        _ = stream.apply(state: state(2), incoming: [envelope(1)])
        #expect(stream.all.count == 2)
    }

    @Test func asksForAPullWhenAPushWasMissed() {
        var stream = SessionStream()
        stream.seed(from: 0, events: [envelope(0)])
        // Ordinal 1 never arrived, so 2 cannot be stored without leaving a hole.
        let outcome = stream.apply(state: state(3), incoming: [envelope(2)])
        #expect(outcome == SyncOutcome(needsPull: true, fromOrdinal: 1))
        #expect(stream.all.count == 1)
    }

    @Test func noticesAGapEvenWhenThePushCarriedNoEvents() {
        // This is the reconnect case: re-subscribing delivers state and nothing else.
        var stream = SessionStream()
        stream.seed(from: 0, events: [envelope(0)])
        let outcome = stream.apply(state: state(9), incoming: [])
        #expect(outcome.needsPull)
    }

    @Test func refusesAPageThatDoesNotAbutTheHead() {
        var stream = SessionStream()
        stream.seed(from: 10, events: [envelope(10)])
        let refused = stream.prepend(from: 5, older: [envelope(5)])
        let taken = stream.prepend(from: 8, older: [envelope(8), envelope(9)])
        #expect(refused == false)
        #expect(taken)
        #expect(stream.firstOrdinal == 8)
    }
}

@Suite struct LiveAccumulatorTests {
    @Test func appendsGrowthWhenTheLengthsAgree() {
        var live = LiveAccumulator()
        live.apply(patch(0, "Hel"))
        live.apply(patch(3, "lo"))
        #expect(live.snapshot?.text == "Hello")
        #expect(live.needsSeed == false)
    }

    @Test func treatsAFromOfZeroAsANewTurn() {
        var live = LiveAccumulator()
        live.seed(LiveSnapshot(thinking: "", text: "previous turn"))
        live.apply(patch(0, "fresh"))
        #expect(live.snapshot?.text == "fresh")
    }

    @Test func trimsTheOverlapWhenTheSenderResends() {
        var live = LiveAccumulator()
        live.seed(LiveSnapshot(thinking: "", text: "Hello world"))
        live.apply(patch(5, " there"))
        #expect(live.snapshot?.text == "Hello there")
    }

    @Test func flagsAReseedWhenItIsBehindTheSender() {
        // Nothing in the patch stream can repair this — only a fresh GET can.
        var live = LiveAccumulator()
        live.seed(LiveSnapshot(thinking: "", text: "Hi"))
        live.apply(patch(50, "!"))
        #expect(live.needsSeed)
        #expect(live.snapshot?.text == "Hi")
    }

    @Test func clearsOnANilPatch() {
        var live = LiveAccumulator()
        live.seed(LiveSnapshot(thinking: "hmm", text: "mid-turn"))
        live.apply(nil)
        #expect(live.snapshot == nil)
    }

    /// The server counts .NET chars — UTF-16 code units. "👍" is two of them and
    /// one Swift `Character`; counting the latter reads every emoji as a missed
    /// push and re-seeds on each one.
    @Test func countsLengthsTheWayTheServerDoes() {
        var live = LiveAccumulator()
        live.apply(patch(0, "ok 👍"))
        live.apply(patch(5, " done"))
        #expect(live.snapshot?.text == "ok 👍 done")
        #expect(live.needsSeed == false)
    }
}
