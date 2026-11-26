// Markdown as agents write it. Each case is a shape that turns up in replies,
// and each failure mode is visible: a list that renders as one paragraph, a
// file name that turns italic, a fence that swallows the rest of the answer.

import Foundation
import Testing
@testable import SlopcoderCore

private func t(_ text: String) -> MarkdownInline { .text(text) }
private func p(_ inlines: MarkdownInline...) -> MarkdownBlock { .paragraph(inlines) }
private func item(_ blocks: MarkdownBlock..., checked: Bool? = nil) -> MarkdownListItem { MarkdownListItem(checked: checked, blocks: blocks) }

@Suite struct MarkdownBlockTests {
    @Test func paragraphsAndSoftBreaks() {
        #expect(Markdown.parse("one\ntwo\n\nthree") == [p(t("one two")), p(t("three"))])
        #expect(Markdown.parse("") == [])
        #expect(Markdown.parse("\n\n  \n") == [])
        #expect(Markdown.parse("hard  \nbreak") == [p(t("hard"), .lineBreak, t("break"))])
        #expect(Markdown.parse("back\\\nslash") == [p(t("back"), .lineBreak, t("slash"))])
        #expect(Markdown.parse("crlf\r\nline") == [p(t("crlf line"))])
    }

    @Test func headings() {
        #expect(Markdown.parse("# One\n## Two ##\n###### Six") == [
            .heading(level: 1, [t("One")]), .heading(level: 2, [t("Two")]), .heading(level: 6, [t("Six")]),
        ])
        // No space is not a heading: it is a hashtag, or an issue number.
        #expect(Markdown.parse("#42 is fixed") == [p(t("#42 is fixed"))])
        #expect(Markdown.parse("####### seven") == [p(t("####### seven"))])
        #expect(Markdown.parse("Title\n=====\n\nSub\n---") == [.heading(level: 1, [t("Title")]), .heading(level: 2, [t("Sub")])])
    }

    @Test func fencedCode() {
        #expect(Markdown.parse("```swift\nlet a = 1\n\n  indented\n```\nafter") == [
            .code(language: "swift", text: "let a = 1\n\n  indented"), p(t("after")),
        ])
        #expect(Markdown.parse("~~~\n```\nnot closed by these\n~~~") == [.code(language: "", text: "```\nnot closed by these")])
        // Markdown inside a fence is code, not markup.
        #expect(Markdown.parse("```\n# not a heading\n- not a list\n```") == [.code(language: "", text: "# not a heading\n- not a list")])
        // An inline span that starts a line is not a fence.
        #expect(Markdown.parse("```code``` in a line") == [p(.code("code"), t(" in a line"))])
    }

    /// While a reply streams, a code block is a fence that has not closed yet.
    @Test func anUnclosedFenceRunsToTheEndRatherThanVanishing() {
        #expect(Markdown.parse("before\n\n```sh\nnpm run bu") == [p(t("before")), .code(language: "sh", text: "npm run bu")])
        #expect(Markdown.parse("```") == [.code(language: "", text: "")])
    }

    @Test func lists() {
        #expect(Markdown.parse("- one\n- two\n* other list") == [
            .list(ordered: false, start: 1, items: [item(p(t("one"))), item(p(t("two"))), item(p(t("other list")))]),
        ])
        #expect(Markdown.parse("3. three\n4. four\n\nafter") == [
            .list(ordered: true, start: 3, items: [item(p(t("three"))), item(p(t("four")))]), p(t("after")),
        ])
        #expect(Markdown.parse("1) paren") == [.list(ordered: true, start: 1, items: [item(p(t("paren")))])])
        // A dash with no space is a word, and a number with no dot is a number.
        #expect(Markdown.parse("-not a list\n1.5 is a number") == [p(t("-not a list 1.5 is a number"))])
    }

    @Test func nestedListsAndContinuations() {
        #expect(Markdown.parse("- outer\n  - inner\n  - inner two\n- next") == [
            .list(ordered: false, start: 1, items: [
                item(p(t("outer")), .list(ordered: false, start: 1, items: [item(p(t("inner"))), item(p(t("inner two")))])),
                item(p(t("next"))),
            ]),
        ])
        #expect(Markdown.parse("1. step\n   ```\n   code\n   ```\n2. then") == [
            .list(ordered: true, start: 1, items: [item(p(t("step")), .code(language: "", text: "code")), item(p(t("then")))]),
        ])
        #expect(Markdown.parse("- wrapped\nlazily\n- two") == [
            .list(ordered: false, start: 1, items: [item(p(t("wrapped lazily"))), item(p(t("two")))]),
        ])
        // Blank lines between items do not end the list.
        #expect(Markdown.parse("- a\n\n- b\n\n  more b") == [
            .list(ordered: false, start: 1, items: [item(p(t("a"))), item(p(t("b")), p(t("more b")))]),
        ])
    }

    @Test func taskLists() {
        #expect(Markdown.parse("- [x] done\n- [ ] todo\n- plain") == [
            .list(ordered: false, start: 1, items: [item(p(t("done")), checked: true), item(p(t("todo")), checked: false), item(p(t("plain")))]),
        ])
    }

    @Test func quotesAndRules() {
        #expect(Markdown.parse("> quoted\n> more\nlazy\n\nout") == [.quote([p(t("quoted more lazy"))]), p(t("out"))])
        #expect(Markdown.parse("> - a\n> - b") == [.quote([.list(ordered: false, start: 1, items: [item(p(t("a"))), item(p(t("b")))])])])
        #expect(Markdown.parse("above\n\n---\n***\n_ _ _") == [p(t("above")), .rule, .rule, .rule])
    }

    @Test func tables() {
        let table = Markdown.parse("| Name | Count |\n|:--|--:|\n| a `|` b | 1 |\n| short |\nafter")
        #expect(table == [
            .table(
                header: [[t("Name")], [t("Count")]],
                alignments: [.leading, .trailing],
                rows: [[[t("a "), .code("|"), t(" b")], [t("1")]], [[t("short")], []]]
            ),
            p(t("after")),
        ])
        // A pipe in prose is not a table.
        #expect(Markdown.parse("a | b\nc | d") == [p(t("a | b c | d"))])
        #expect(Markdown.parse("Intro:\n| A |\n|---|\n| 1 |") == [
            p(t("Intro:")), .table(header: [[t("A")]], alignments: [.leading], rows: [[[t("1")]]]),
        ])
    }

    @Test func indentedCode() {
        #expect(Markdown.parse("text\n\n    code line\n\n    more\nback") == [p(t("text")), .code(language: "", text: "code line\n\nmore"), p(t("back"))])
    }
}

@Suite struct MarkdownInlineTests {
    @Test func emphasis() {
        #expect(Markdown.parseInline("a *em* **strong** ***both*** ~~gone~~") == [
            t("a "), .emphasis([t("em")]), t(" "), .strong([t("strong")]), t(" "), .strong([.emphasis([t("both")])]), t(" "), .strike([t("gone")]),
        ])
        #expect(Markdown.parseInline("_em_ __strong__") == [.emphasis([t("em")]), t(" "), .strong([t("strong")])])
        #expect(Markdown.parseInline("**bold with *nested* inside**") == [.strong([t("bold with "), .emphasis([t("nested")]), t(" inside")])])
    }

    /// The ways emphasis is got wrong: a file name turns italic, arithmetic loses
    /// its operators, a streaming `**` eats the paragraph.
    @Test func leavesWhatIsNotEmphasisAlone() {
        #expect(Markdown.parseInline("snake_case_name and __init__.py") == [t("snake_case_name and "), .strong([t("init")]), t(".py")])
        #expect(Markdown.parseInline("my_file_name.txt") == [t("my_file_name.txt")])
        #expect(Markdown.parseInline("2 * 3 * 4") == [t("2 * 3 * 4")])
        #expect(Markdown.parseInline("an unclosed **bold") == [t("an unclosed **bold")])
        #expect(Markdown.parseInline("stars ****") == [t("stars ****")])
        #expect(Markdown.parseInline("escaped \\*not em\\*") == [t("escaped *not em*")])
        #expect(Markdown.parseInline("~one tilde~") == [t("~one tilde~")])
    }

    @Test func code() {
        #expect(Markdown.parseInline("run `npm ci` now") == [t("run "), .code("npm ci"), t(" now")])
        #expect(Markdown.parseInline("`` a ` b ``") == [.code("a ` b")])
        #expect(Markdown.parseInline("`*not em*`") == [.code("*not em*")])
        #expect(Markdown.parseInline("an unclosed `tick") == [t("an unclosed `tick")])
        #expect(Markdown.parseInline("*em with `a * b` code*") == [.emphasis([t("em with "), .code("a * b"), t(" code")])])
    }

    @Test func links() {
        #expect(Markdown.parseInline("see [the docs](https://example.com/a_(b) \"title\").") == [
            t("see "), .link(href: "https://example.com/a_(b)", children: [t("the docs")]), t("."),
        ])
        // The web's own spelling of an artifact, which the app routes itself.
        #expect(Markdown.parseInline("[report](/artifacts/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b)") == [
            .link(href: "/artifacts/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", children: [t("report")]),
        ])
        #expect(Markdown.parseInline("[**bold** link](<a b>)") == [.link(href: "a b", children: [.strong([t("bold")]), t(" link")])])
        #expect(Markdown.parseInline("[not a link] and [also](") == [t("[not a link] and [also](")])
        #expect(Markdown.parseInline("![a chart](/artifacts/x/raw)") == [.image(alt: "a chart", source: "/artifacts/x/raw")])
        #expect(Markdown.parseInline("<https://example.com> <not a link>") == [
            .link(href: "https://example.com", children: [t("https://example.com")]), t(" <not a link>"),
        ])
    }

    @Test func bareUrlsAreLinksAndTheirPunctuationIsNot() {
        #expect(Markdown.parseInline("at https://example.com/x?y=1, then (https://a.b/c).") == [
            t("at "), .link(href: "https://example.com/x?y=1", children: [t("https://example.com/x?y=1")]), t(", then ("),
            .link(href: "https://a.b/c", children: [t("https://a.b/c")]), t(")."),
        ])
        #expect(Markdown.parseInline("https://en.wikipedia.org/wiki/Swift_(language)") == [
            .link(href: "https://en.wikipedia.org/wiki/Swift_(language)", children: [t("https://en.wikipedia.org/wiki/Swift_(language)")]),
        ])
        #expect(Markdown.parseInline("xhttps://no and http:// alone") == [t("xhttps://no and http:// alone")])
    }

    @Test func plainTextDropsTheMarkup() {
        #expect(Markdown.plainText(Markdown.parseInline("**Bold** `code` [link](x) ![alt](y)")) == "Bold code link alt")
    }

    /// The tail is re-parsed on every push; nothing it can be mid-way through
    /// may trap or loop.
    @Test func survivesEveryPrefixOfADocument() {
        let document = "# T\n\n- a **b** `c` [d](e)\n  1. n\n> q\n\n| a | b |\n|--|--|\n| 1 | 2 |\n\n```x\ncode\n```\n![i](j) <https://k> ~~s~~ _u_\n\n    indented\n***\n"
        let scalars = Array(document.unicodeScalars)
        for end in 0...scalars.count {
            _ = Markdown.parse(String(String.UnicodeScalarView(scalars[0..<end])))
        }
        for garbage in ["[[[[", "((((", "]]]]", "****", "`````", "| | |\n|-", "> > > >", "- - - -", "1. 2. 3.", "\\", "<<<>>>", "![", "](", "~~~~~", "_ _ _ _"] {
            _ = Markdown.parse(garbage)
        }
    }
}
