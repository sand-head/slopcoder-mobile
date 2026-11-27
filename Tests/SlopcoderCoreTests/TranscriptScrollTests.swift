// The list's arithmetic. Each of these, got wrong, is a transcript that opens
// blank, jumps when history arrives, or redraws every row on every push — and
// none of it can be seen from here, so it is pinned here instead.

import Foundation
import Testing
@testable import SlopcoderCore

private func text(_ key: String, _ body: String = "hello") -> Item {
    Item(key: key, ordinal: 0, body: .text(TextItem(text: body)))
}

private func approval(_ key: String, request: String) -> Item {
    Item(key: key, ordinal: 0, body: .approval(ApprovalItem(requestId: request, toolName: "bash", input: "{}", reason: "", refused: false)))
}

private func tool(_ key: String, running: Bool = false) -> Item {
    Item(key: key, ordinal: 0, body: .tool(ToolItem(name: "bash", input: "{}", result: nil, isError: false, running: running)))
}

private func user(_ key: String) -> Item {
    Item(key: key, ordinal: 0, body: .user(UserItem(text: "hi", steering: false, images: [])))
}

@Suite struct TranscriptStackTests {
    @Test func stacksRowsWithSpacingAndPadding() {
        let stack = TranscriptStack(heights: [10, 20, 30], spacing: 4, padding: 16)
        #expect(stack.tops == [16, 30, 54])
        #expect(stack.contentHeight == 16 + 10 + 4 + 20 + 4 + 30 + 16)
        #expect(TranscriptStack(heights: [], spacing: 4, padding: 16).contentHeight == 32)
    }

    @Test func findsTheRowAtAPoint() {
        let stack = TranscriptStack(heights: [10, 20, 30], spacing: 4, padding: 16)
        #expect(stack.first(endingBelow: 0) == 0)
        #expect(stack.first(endingBelow: 25) == 0)
        // In the gap after the first row: the next one is the first still to come.
        #expect(stack.first(endingBelow: 27) == 1)
        #expect(stack.first(endingBelow: 83) == 2)
        #expect(stack.first(endingBelow: 84) == nil)
        #expect(stack.indices(overlapping: 27, 60) == 1..<3)
        #expect(stack.indices(overlapping: 0, 16) == 0..<0)
        #expect(stack.indices(overlapping: 200, 300) == 3..<3)
    }
}

@Suite struct ReadingColumnTests {
    @Test func aPhoneUprightIsThePaddedWidth() {
        let column = ReadingColumn.frame(width: 390, left: 0, right: 0, padding: 21, maxWidth: 760)
        #expect(column.x == 21)
        #expect(column.width == 348)
    }

    @Test func aVerticalBarOnTheRightTakesItsShareBeforeTheColumnIsCentred() {
        let column = ReadingColumn.frame(width: 400, left: 0, right: 60, padding: 21, maxWidth: 760)
        #expect(column.x == 21)
        #expect(column.width == 298)
        #expect(column.x + column.width + 21 + 60 == 400)
    }

    @Test func aWideWindowHoldsTheMeasureAndCentresItInTheSafeArea() {
        let column = ReadingColumn.frame(width: 1200, left: 40, right: 0, padding: 21, maxWidth: 760)
        #expect(column.width == 718)
        #expect(column.x == 40 + (1160 - 760) / 2 + 21)
    }
}

@Suite struct ScrollViewportTests {
    private let viewport = ScrollViewport(offset: 0, height: 800, insetTop: 100, insetBottom: 150, contentHeight: 2000)

    @Test func theEndIsTheLastLineAboveTheComposer() {
        #expect(viewport.minOffset == -100)
        #expect(viewport.maxOffset == 2000 + 150 - 800)
        #expect(viewport.visibleHeight == 550)
    }

    @Test func aShortTranscriptEndsWhereItStarts() {
        let short = ScrollViewport(offset: -100, height: 800, insetTop: 100, insetBottom: 150, contentHeight: 300)
        #expect(short.maxOffset == -100)
        #expect(short.isAtEnd())
    }

    @Test func nearlyAtTheEndIsAtTheEnd() {
        var at = viewport
        at.offset = viewport.maxOffset - 3
        #expect(at.isAtEnd())
        at.offset = viewport.maxOffset - 40
        #expect(!at.isAtEnd())
    }

    @Test func earlierHistoryIsAskedForWithinAScreenOfTheTop() {
        var at = viewport
        at.offset = -100 + 549
        #expect(TranscriptScroll.nearTop(at))
        at.offset = -100 + 551
        #expect(!TranscriptScroll.nearTop(at))
    }
}

@Suite struct ScrollAnchorTests {
    private let entries: [TranscriptEntry] = [.row("a"), .row("b"), .row("c"), .row("d")]

    @Test func theAnchorIsTheRowAtTheTopOfWhatCanBeSeen() {
        let stack = TranscriptStack(heights: [100, 100, 100, 100], spacing: 0, padding: 0)
        let viewport = ScrollViewport(offset: 50, height: 300, insetTop: 100, insetBottom: 0, contentHeight: stack.contentHeight)
        // Visible from 150: row b, which starts 50 above it.
        #expect(TranscriptScroll.anchor(entries, stack, viewport) == ScrollAnchor(entry: .row("b"), distance: -50))
    }

    @Test func aPageArrivingAboveLeavesTheReaderOnTheSameLine() {
        let before = TranscriptStack(heights: [100, 100, 100, 100], spacing: 4, padding: 16)
        let viewport = ScrollViewport(offset: 100, height: 300, insetTop: 50, insetBottom: 80, contentHeight: before.contentHeight)
        let anchor = TranscriptScroll.anchor(entries, before, viewport)
        let onScreen = before.tops[entries.firstIndex(of: anchor!.entry)!] - viewport.offset

        let grown: [TranscriptEntry] = [.earlier, .row("x"), .row("y")] + entries
        let after = TranscriptStack(heights: [40, 300, 120, 100, 100, 100, 100], spacing: 4, padding: 16)
        var next = viewport
        next.contentHeight = after.contentHeight
        let offset = TranscriptScroll.offset(following: false, anchor: anchor, entries: grown, stack: after, before: viewport, after: next)
        #expect(anchor?.entry == .row("b"))
        #expect(offset < next.maxOffset)
        #expect(after.tops[grown.firstIndex(of: anchor!.entry)!] - offset == onScreen)
    }

    @Test func aRowAboveGrowingMovesNothingInView() {
        let before = TranscriptStack(heights: [100, 100, 100, 100], spacing: 0, padding: 0)
        let viewport = ScrollViewport(offset: 150, height: 200, insetTop: 0, insetBottom: 0, contentHeight: 400)
        let anchor = TranscriptScroll.anchor(entries, before, viewport)
        #expect(anchor?.entry == .row("b"))
        let after = TranscriptStack(heights: [180, 100, 100, 100], spacing: 0, padding: 0)
        var next = viewport
        next.contentHeight = after.contentHeight
        #expect(TranscriptScroll.offset(following: false, anchor: anchor, entries: entries, stack: after, before: viewport, after: next) == 230)
    }

    @Test func aRowInViewGrowingDownwardStaysPut() {
        let before = TranscriptStack(heights: [100, 100, 100, 100], spacing: 0, padding: 0)
        let viewport = ScrollViewport(offset: 100, height: 200, insetTop: 0, insetBottom: 0, contentHeight: 400)
        let anchor = TranscriptScroll.anchor(entries, before, viewport)
        let after = TranscriptStack(heights: [100, 100, 400, 100], spacing: 0, padding: 0)
        var next = viewport
        next.contentHeight = after.contentHeight
        #expect(TranscriptScroll.offset(following: false, anchor: anchor, entries: entries, stack: after, before: viewport, after: next) == 100)
    }

    @Test func followingGoesToTheNewEnd() {
        let after = TranscriptStack(heights: [100, 100, 100, 500], spacing: 0, padding: 0)
        let before = ScrollViewport(offset: 200, height: 200, insetTop: 0, insetBottom: 0, contentHeight: 400)
        var next = before
        next.contentHeight = after.contentHeight
        #expect(TranscriptScroll.offset(following: true, anchor: nil, entries: entries, stack: after, before: before, after: next) == 600)
    }

    @Test func theKeyboardPushesTheContentUp() {
        let stack = TranscriptStack(heights: [100, 100, 100, 100], spacing: 0, padding: 0)
        let before = ScrollViewport(offset: 100, height: 300, insetTop: 0, insetBottom: 50, contentHeight: 400)
        let anchor = TranscriptScroll.anchor(entries, stack, before)
        var after = before
        after.insetBottom = 350
        #expect(TranscriptScroll.offset(following: false, anchor: anchor, entries: entries, stack: stack, before: before, after: after) == 400)
        // And back down, no further than the top.
        var back = after
        back.offset = 400
        let atTop = TranscriptScroll.anchor(entries, stack, back)
        #expect(TranscriptScroll.offset(following: false, anchor: atTop, entries: entries, stack: stack, before: back, after: ScrollViewport(offset: 400, height: 300, insetTop: 0, insetBottom: 50, contentHeight: 400)) == 100)
    }

    @Test func aRowIsCentredWhereTheEndsAllow() {
        let stack = TranscriptStack(heights: [100, 100, 100, 100, 100], spacing: 0, padding: 0)
        let viewport = ScrollViewport(offset: 0, height: 300, insetTop: 50, insetBottom: 50, contentHeight: 500)
        #expect(TranscriptScroll.centring(2, stack, viewport) == 250 - 50 - 100)
        #expect(TranscriptScroll.centring(0, stack, viewport) == -50)
        #expect(TranscriptScroll.centring(4, stack, viewport) == viewport.maxOffset)
    }
}

@Suite struct HeightCacheTests {
    @Test func remembersEachWidthUntilTooManyAreSeen() {
        var cache = HeightCache(widths: 2)
        cache.set(.row("a"), width: 300, height: 10)
        cache.set(.row("a"), width: 600, height: 5)
        #expect(cache.height(.row("a"), width: 300) == 10)
        cache.set(.row("a"), width: 300, height: 11)
        cache.set(.row("a"), width: 900, height: 3)
        // 600 was the least recently measured, so it went.
        #expect(cache.height(.row("a"), width: 600) == nil)
        #expect(cache.height(.row("a"), width: 300) == 11)
        #expect(cache.height(.row("a"), width: 900) == 3)
    }

    @Test func aChangedRowIsForgottenAtEveryWidth() {
        var cache = HeightCache()
        cache.set(.row("a"), width: 300, height: 10)
        cache.set(.row("a"), width: 600, height: 5)
        cache.set(.live, width: 300, height: 7)
        cache.invalidate(.row("a"))
        #expect(cache.height(.row("a"), width: 300) == nil)
        #expect(cache.height(.row("a"), width: 600) == nil)
        #expect(cache.height(.live, width: 300) == 7)
    }
}

@Suite struct TranscriptChangesTests {
    @Test func anUnchangedRowIsLeftAlone() {
        let rows: [DisplayRow] = [.item(text("a")), .item(approval("b", request: "r1"))]
        let changes = TranscriptChanges.between(rows, rows + [.item(text("c"))], before: .init(), after: .init())
        #expect(changes.changed.isEmpty)
        #expect(changes.removed.isEmpty)
    }

    @Test func aRowWhoseDataChangedIsRedrawn() {
        let before: [DisplayRow] = [.item(text("a")), .item(tool("b", running: true))]
        let after: [DisplayRow] = [.item(text("a")), .item(tool("b", running: false))]
        #expect(TranscriptChanges.between(before, after, before: .init(), after: .init()).changed == ["b"])
    }

    @Test func anAnsweredApprovalRedrawsOnlyTheApprovals() {
        let rows: [DisplayRow] = [
            .item(text("a")), .item(approval("b", request: "r1")), .item(user("c")),
            .toolRun(ToolRun(key: "tools:d", tools: [tool("d"), tool("e")])),
        ]
        let changes = TranscriptChanges.between(
            rows, rows,
            before: RowCircumstances(pendingApprovals: ["r1"]), after: RowCircumstances(pendingApprovals: [])
        )
        #expect(changes.changed == ["b"])
    }

    @Test func eachCircumstanceReachesTheRowsThatReadIt() {
        let sub = Item(key: "s", ordinal: 0, body: .subsession(SubSessionItem(subSessionId: "x", name: "n", model: "m", profile: "p", persona: "Ada", color: "blue")))
        let rows: [DisplayRow] = [.item(text("a")), .item(user("u")), .item(sub)]
        let mentions = TranscriptChanges.between(rows, rows, before: .init(), after: RowCircumstances(mentions: [SubSessionMention(persona: "Ada", color: "blue")]))
        #expect(mentions.changed == ["a"])
        let parent = TranscriptChanges.between(rows, rows, before: .init(), after: RowCircumstances(parentDriven: true))
        #expect(parent.changed == ["u"])
    }

    @Test func aSubagentThreadReadsWhatItsItemsRead() {
        let group = SubagentGroup(key: "g", subagentId: 1, task: "t", model: "m", items: [approval("x", request: "r9")])
        #expect(DisplayRow.subagent(group).reads == .approvals)
        let changes = TranscriptChanges.between(
            [.subagent(group)], [.subagent(group)],
            before: .init(), after: RowCircumstances(pendingApprovals: ["r9"])
        )
        #expect(changes.changed == ["g"])
    }

    @Test func aRowThatLeftIsRemoved() {
        let before: [DisplayRow] = [.item(text("a")), .item(text("b"))]
        let changes = TranscriptChanges.between(before, [.item(text("b"))], before: .init(), after: .init())
        #expect(changes.removed == ["a"])
        #expect(changes.changed.isEmpty)
    }

    @Test func aRepeatedIdIsShownOnce() {
        let rows: [DisplayRow] = [.item(text("a", "first")), .item(text("b")), .item(text("a", "second"))]
        #expect(TranscriptChanges.unique(rows).map(\.id) == ["a", "b"])
        #expect(TranscriptChanges.unique(rows).first == .item(text("a", "first")))
    }
}
