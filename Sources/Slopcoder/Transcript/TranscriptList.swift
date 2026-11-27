#if canImport(UIKit)
import SlopcoderCore
import SwiftUI
import UIKit

/// The session's transcript: a collection view of SwiftUI rows, each measured
/// exactly, so that the list knows its true length before anything is drawn.
///
/// A lazy SwiftUI stack only guesses at the rows it has not built, so a
/// transcript that starts at its end came up blank, its scroll bar lurched and
/// "go to the end" went to the wrong place. An eager stack fixed that by
/// building everything, at a cost that grew with the session. Here each row has
/// its own hosted view, measured once per width and again only when what it
/// draws changes, and a plain layout stacks them by those heights.
///
/// Each row keeps its hosted view for as long as it is in the transcript, so
/// what a row holds — a card the reader opened, an answer half typed — is still
/// there when they scroll back to it. A row off screen is taken out of the
/// window, so what it does while visible (a sub-session's live stream, an image
/// load) stops when it scrolls away and starts again when it comes back.
///
/// The arithmetic — where rows go, whether the reader is at the end, where to
/// put them back — is `TranscriptScroll` in the core, tested there.
struct TranscriptList: UIViewRepresentable {
    let rows: [DisplayRow]
    let context: RowContext
    let live: LiveSnapshot?
    /// The spinner above the first row: there is history still to load.
    let showsEarlier: Bool
    /// Everything that floats over the list, as SwiftUI sees it: the bars, the
    /// banner, the composer and the keyboard.
    let insets: EdgeInsets
    let scroller: TranscriptScroller
    let onPinned: (Bool) -> Void
    let onNearTop: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(AuthStore.self) private var auth
    @Environment(ConnectionStatus.self) private var connection
    @Environment(Router.self) private var router
    @Environment(RoutineAlert.self) private var routineAlert
    @Environment(\.wideWindow) private var wide
    @Environment(\.layoutDirection) private var direction

    func makeUIView(context: Context) -> TranscriptCollectionView {
        TranscriptCollectionView()
    }

    func updateUIView(_ view: TranscriptCollectionView, context: Context) {
        scroller.list = view
        view.onPinned = onPinned
        view.onNearTop = onNearTop
        let leftToRight = direction == .leftToRight
        let edges = UIEdgeInsets(
            top: insets.top,
            left: leftToRight ? insets.leading : insets.trailing,
            bottom: insets.bottom,
            right: leftToRight ? insets.trailing : insets.leading
        )
        let surroundings = Surroundings(
            model: model, auth: auth, connection: connection, router: router, routineAlert: routineAlert, wide: wide
        )
        let update = {
            view.update(rows: rows, context: self.context, live: live, showsEarlier: showsEarlier, insets: edges, surroundings: surroundings)
        }
        // The keyboard and the composer move with an animation; the content
        // they push up should move with the same one.
        if view.insetsWouldChange(edges), #available(iOS 18.0, *) {
            context.animate {
                update()
                view.layoutIfNeeded()
            }
        } else {
            update()
        }
    }
}

/// How the screen moves the list: to its end, or to one row.
@MainActor
final class TranscriptScroller {
    fileprivate weak var list: TranscriptCollectionView?

    /// To the end, with a glide, and following it from there.
    func toEnd() { list?.toEnd() }

    /// A row into the middle of the screen — once it is in the list, if the
    /// page it is on is still arriving.
    func reveal(_ id: String) { list?.reveal(id) }
}

/// What the app puts in the environment at its root. A hosted row is not under
/// that root — SwiftUI does not carry its environment through UIKit — so it is
/// handed on here. A row that reads an object missing from its environment
/// does not draw wrong; it crashes.
private struct Surroundings: ViewModifier, Equatable {
    let model: AppModel
    let auth: AuthStore
    let connection: ConnectionStatus
    let router: Router
    let routineAlert: RoutineAlert
    let wide: Bool

    func body(content: Content) -> some View {
        content
            .environment(model)
            .environment(auth)
            .environment(connection)
            .environment(router)
            .environment(routineAlert)
            .environment(\.wideWindow, wide)
            .tint(Palette.primary)
    }

    nonisolated static func == (a: Surroundings, b: Surroundings) -> Bool {
        a.model === b.model && a.auth === b.auth && a.connection === b.connection
            && a.router === b.router && a.routineAlert === b.routineAlert && a.wide == b.wide
    }
}

private typealias Host = UIView & UIContentView

final class TranscriptCollectionView: UIView, UICollectionViewDelegate {
    var onPinned: (Bool) -> Void = { _ in }
    var onNearTop: () -> Void = {}

    private let layout = StackLayout()
    private let collection: UICollectionView
    private var dataSource: UICollectionViewDiffableDataSource<Int, TranscriptEntry>!
    /// Where a row's hosted view waits while no cell shows it: out of the
    /// window, with the window's traits copied on so it measures as it draws.
    private let parking = UIView()
    private var hosts: [TranscriptEntry: Host] = [:]
    private var heights = HeightCache()

    private var rows: [DisplayRow] = []
    private var rowsById: [String: DisplayRow] = [:]
    private var context = RowContext()
    private var live: LiveSnapshot?
    private var showsEarlier = false
    private var surroundings: Surroundings?
    private var insets = UIEdgeInsets.zero

    /// As of the last layout: what was stacked, and around what.
    private var entries: [TranscriptEntry] = []
    private var laidInsets = UIEdgeInsets.zero
    /// The data changed since the last layout, as opposed to a row resizing
    /// itself (a card opened, an image arrived).
    private var dataChanged = false
    private var rowsResized = false

    private var pinned = true
    private var reportedPinned: Bool?
    /// The list itself is moving the content, not the reader.
    private var moving = false
    private var gliding = false
    private var revealing = false
    private var pendingReveal: String?

    init() {
        collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(frame: .zero)

        collection.backgroundColor = .clear
        collection.allowsSelection = false
        collection.alwaysBounceVertical = true
        collection.showsHorizontalScrollIndicator = false
        collection.showsVerticalScrollIndicator = true
        collection.keyboardDismissMode = .interactive
        // Every inset is set by hand from what SwiftUI reports; see `update`.
        collection.contentInsetAdjustmentBehavior = .never
        collection.automaticallyAdjustsScrollIndicatorInsets = false
        if #available(iOS 26.0, *) {
            // The bars and the composer float over the list; what scrolls
            // under them fades rather than being cut off.
            collection.topEdgeEffect.style = .soft
            collection.bottomEdgeEffect.style = .soft
        }
        collection.delegate = self
        addSubview(collection)

        let registration = UICollectionView.CellRegistration<HostCell, TranscriptEntry> { [unowned self] cell, _, entry in
            cell.hold(self.host(for: entry), parking: self.parking)
        }
        dataSource = UICollectionViewDiffableDataSource(collectionView: collection) { collection, indexPath, entry in
            collection.dequeueConfiguredReusableCell(using: registration, for: indexPath, item: entry)
        }
        var empty = NSDiffableDataSourceSnapshot<Int, TranscriptEntry>()
        empty.appendSections([0])
        dataSource.apply(empty, animatingDifferences: false)

        copyTraits()
        registerForTraitChanges(
            [UITraitPreferredContentSizeCategory.self, UITraitLegibilityWeight.self, UITraitLayoutDirection.self,
             UITraitUserInterfaceStyle.self, UITraitDisplayScale.self]
        ) { (self: TranscriptCollectionView, _: UITraitCollection) in
            self.copyTraits()
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: what the screen says

    func insetsWouldChange(_ next: UIEdgeInsets) -> Bool { next != insets }

    fileprivate func update(
        rows next: [DisplayRow], context nextContext: RowContext, live nextLive: LiveSnapshot?,
        showsEarlier nextEarlier: Bool, insets nextInsets: UIEdgeInsets, surroundings nextSurroundings: Surroundings
    ) {
        let unique = TranscriptChanges.unique(next)
        let before = context.circumstances
        let after = nextContext.circumstances
        let mentionsChanged = before.mentions != after.mentions
        let sameRows = unique == rows
        let changes = sameRows && before == after
            ? RowChanges()
            : TranscriptChanges.between(rows, unique, before: before, after: after)
        if !sameRows {
            rows = unique
            rowsById = Dictionary(unique.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        }
        context = nextContext

        if surroundings != nextSurroundings {
            let first = surroundings == nil
            surroundings = nextSurroundings
            if !first {
                for entry in hosts.keys { reconfigure(entry) }
                heights.removeAll()
                dataChanged = true
            }
        }
        for id in changes.changed { reconfigure(.row(id)) }
        for id in changes.removed { drop(.row(id)) }
        if !changes.changed.isEmpty || !changes.removed.isEmpty { dataChanged = true }

        if nextLive != live || (nextLive != nil && mentionsChanged) {
            live = nextLive
            if nextLive == nil { drop(.live) } else { reconfigure(.live) }
            dataChanged = true
        }
        if nextEarlier != showsEarlier {
            showsEarlier = nextEarlier
            if !nextEarlier { drop(.earlier) }
        }
        let insetsChanged = nextInsets != insets
        insets = nextInsets

        // A keystroke in the composer redraws the screen and lands here; it
        // must not cost a layout of the list.
        if dataChanged || insetsChanged || currentEntries() != entries {
            setNeedsLayout()
        }
    }

    /// Go to the end, with a glide, and follow it from there.
    func toEnd() {
        pendingReveal = nil
        revealing = false
        pinned = true
        report()
        let target = viewport().maxOffset
        guard abs(target - collection.contentOffset.y) > 0.5 else { return }
        gliding = true
        collection.setContentOffset(CGPoint(x: collection.contentOffset.x, y: target), animated: true)
    }

    func reveal(_ id: String) {
        pendingReveal = id
        setNeedsLayout()
    }

    // MARK: layout

    override func layoutSubviews() {
        super.layoutSubviews()
        if collection.frame != bounds { collection.frame = bounds }
        reflow()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        setNeedsLayout()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        copyTraits()
    }

    /// SwiftUI's account of what covers the list, and UIKit's own, taken edge by
    /// edge at whichever is larger. They should agree; where one cannot see
    /// something (UIKit does not know about the composer, and a representable's
    /// safe area is SwiftUI's to give or not), the other still keeps the content
    /// clear of it. Neither can be added to the other: the bars are in both.
    private var effectiveInsets: UIEdgeInsets {
        let own = safeAreaInsets
        return UIEdgeInsets(
            top: max(insets.top, own.top), left: max(insets.left, own.left),
            bottom: max(insets.bottom, own.bottom), right: max(insets.right, own.right)
        )
    }

    private func currentEntries() -> [TranscriptEntry] {
        (showsEarlier ? [.earlier] : []) + rows.map { .row($0.id) } + (live != nil ? [.live] : [])
    }

    private func viewport(insets: UIEdgeInsets? = nil, contentHeight: Double? = nil) -> ScrollViewport {
        let insets = insets ?? collection.contentInset
        return ScrollViewport(
            offset: collection.contentOffset.y,
            height: collection.bounds.height,
            insetTop: insets.top,
            insetBottom: insets.bottom,
            contentHeight: contentHeight ?? layout.stack.contentHeight
        )
    }

    /// Measure what needs it, stack the rows, and put the reader back where
    /// they were — or at the end, if that is where they were.
    private func reflow() {
        guard bounds.width > 0, bounds.height > 0 else { return }
        let covered = effectiveInsets
        let column = ReadingColumn.frame(
            width: bounds.width, left: covered.left, right: covered.right,
            padding: Reading.column, maxWidth: Reading.maxWidth
        )
        let next = currentEntries()
        let stack = TranscriptStack(
            heights: next.map { height(of: $0, width: column.width) },
            spacing: StackLayout.spacing, padding: StackLayout.padding
        )
        let sameColumn = column == layout.column
        if stack == layout.stack, sameColumn, next == entries, covered == laidInsets {
            dataChanged = false
            rowsResized = false
            settle()
            return
        }

        moving = true
        defer { moving = false }
        let before = viewport(insets: laidInsets)
        let anchor = TranscriptScroll.anchor(entries, layout.stack, before)
        // A card the reader opened grows where it is; everything else that
        // happens at the end — a new row, the streaming tail, the keyboard —
        // keeps a reader who is at the end there.
        let onlyResized = rowsResized && !dataChanged && next == entries && sameColumn && covered == laidInsets
        let following = pinned && !onlyResized && !collection.isTracking

        layout.stack = stack
        layout.column = column
        layout.invalidateLayout()
        if next != entries {
            var snapshot = NSDiffableDataSourceSnapshot<Int, TranscriptEntry>()
            snapshot.appendSections([0])
            snapshot.appendItems(next)
            dataSource.apply(snapshot, animatingDifferences: false)
        }
        entries = next
        laidInsets = covered
        dataChanged = false
        rowsResized = false

        collection.contentInset = UIEdgeInsets(top: covered.top, left: 0, bottom: covered.bottom, right: 0)
        // The bar belongs at the edge of the safe area, beside the text: not
        // at the edge of the glass, where an iPhone Duo stands its toolbar.
        // `automaticallyAdjustsScrollIndicatorInsets` is off, so this is the
        // whole of the inset and nothing is added to it.
        collection.verticalScrollIndicatorInsets = UIEdgeInsets(
            top: covered.top, left: covered.left + StackLayout.indicatorGap,
            bottom: covered.bottom, right: covered.right + StackLayout.indicatorGap
        )

        if onlyResized {
            UIView.animate(withDuration: 0.2) { self.collection.layoutIfNeeded() }
        } else {
            collection.layoutIfNeeded()
        }

        if !gliding && !revealing {
            var after = viewport(contentHeight: stack.contentHeight)
            after.offset = before.offset
            let target = TranscriptScroll.offset(
                following: following, anchor: anchor, entries: next, stack: stack, before: before, after: after
            )
            if abs(target - collection.contentOffset.y) > 0.25 {
                collection.contentOffset = CGPoint(x: collection.contentOffset.x, y: target)
            }
        }
        settle()
    }

    /// After a layout: a row waiting to be shown, history to ask for, and the
    /// screen told whether the reader is at the end.
    private func settle() {
        if let id = pendingReveal, let index = entries.firstIndex(of: .row(id)), index < layout.stack.count {
            pendingReveal = nil
            pinned = false
            let target = TranscriptScroll.centring(index, layout.stack, viewport())
            if abs(target - collection.contentOffset.y) > 0.5 {
                revealing = true
                collection.setContentOffset(CGPoint(x: collection.contentOffset.x, y: target), animated: true)
            } else {
                pinned = viewport().isAtEnd()
            }
        }
        askForEarlier()
        report()
    }

    private func askForEarlier() {
        guard showsEarlier, TranscriptScroll.nearTop(viewport()) else { return }
        let ask = onNearTop
        DispatchQueue.main.async { ask() }
    }

    private func report() {
        guard reportedPinned != pinned else { return }
        reportedPinned = pinned
        let pinned = self.pinned
        let tell = onPinned
        // Never from inside SwiftUI's update of this view.
        DispatchQueue.main.async { tell(pinned) }
    }

    // MARK: rows

    private func height(of entry: TranscriptEntry, width: Double) -> Double {
        if let known = heights.height(entry, width: width) { return known }
        let host = host(for: entry)
        if host.superview === parking || host.superview == nil {
            host.frame = CGRect(x: 0, y: 0, width: width, height: max(host.frame.height, 1))
        }
        let size = host.systemLayoutSizeFitting(
            CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        let measured = max(0, Double(size.height))
        heights.set(entry, width: width, height: measured)
        return measured
    }

    /// A row's own report of its size, from SwiftUI: how a card opening, or an
    /// image arriving, reaches the layout.
    private func resized(_ entry: TranscriptEntry, to size: CGSize) {
        let width = layout.column.width
        guard hosts[entry] != nil, abs(Double(size.width) - width) < 0.5 else { return }
        if let known = heights.height(entry, width: width), abs(known - Double(size.height)) < 0.5 { return }
        heights.invalidate(entry)
        heights.set(entry, width: width, height: Double(size.height))
        if entry == .live { dataChanged = true } else { rowsResized = true }
        setNeedsLayout()
    }

    private func host(for entry: TranscriptEntry) -> Host {
        if let host = hosts[entry] { return host }
        let host = configuration(for: entry).makeContentView()
        parking.addSubview(host)
        hosts[entry] = host
        return host
    }

    /// Draw a row again with what it now shows. Its hosted view stays, so what
    /// it holds of its own stays with it.
    private func reconfigure(_ entry: TranscriptEntry) {
        heights.invalidate(entry)
        guard let host = hosts[entry] else { return }
        host.configuration = configuration(for: entry)
    }

    private func drop(_ entry: TranscriptEntry) {
        heights.invalidate(entry)
        hosts.removeValue(forKey: entry)?.removeFromSuperview()
    }

    private func configuration(for entry: TranscriptEntry) -> UIHostingConfiguration<HostedEntry, EmptyView> {
        let content: HostedEntry.Content
        switch entry {
        case .earlier:
            content = .earlier
        case .row(let id):
            content = rowsById[id].map { .row($0, context) } ?? .earlier
        case .live:
            content = .live(live ?? LiveSnapshot(), context.mentions)
        }
        let hosted = HostedEntry(content: content, surroundings: surroundings) { [weak self] size in
            self?.resized(entry, to: size)
        }
        return UIHostingConfiguration { hosted }
            .margins(.all, 0)
            .minSize(width: 0, height: 0)
    }

    /// The parked rows measure as they will draw: same type size, same bold
    /// text, same direction, same scale.
    private func copyTraits() {
        let traits = traitCollection
        let before = parking.traitCollection
        parking.traitOverrides.preferredContentSizeCategory = traits.preferredContentSizeCategory
        parking.traitOverrides.legibilityWeight = traits.legibilityWeight
        parking.traitOverrides.layoutDirection = traits.layoutDirection
        parking.traitOverrides.userInterfaceStyle = traits.userInterfaceStyle
        parking.traitOverrides.displayScale = traits.displayScale
        if before.preferredContentSizeCategory != traits.preferredContentSizeCategory
            || before.legibilityWeight != traits.legibilityWeight
            || before.displayScale != traits.displayScale {
            heights.removeAll()
            dataChanged = true
            setNeedsLayout()
        }
    }

    // MARK: the reader

    func collectionView(_ collectionView: UICollectionView, didEndDisplaying cell: UICollectionViewCell, forItemAt indexPath: IndexPath) {
        (cell as? HostCell)?.release(to: parking)
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        gliding = false
        revealing = false
        pendingReveal = nil
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard !moving else { return }
        if !gliding && !revealing {
            pinned = viewport().isAtEnd()
            report()
        }
        askForEarlier()
    }

    func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
        if gliding {
            gliding = false
            // The end may have moved while the glide was under way.
            if pinned { setNeedsLayout(); jumpToEnd() }
        } else if revealing {
            revealing = false
            pinned = viewport().isAtEnd()
            report()
        }
    }

    func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
        pinned = false
        report()
        return true
    }

    private func jumpToEnd() {
        let target = viewport().maxOffset
        guard abs(target - collection.contentOffset.y) > 0.25 else { return }
        moving = true
        collection.contentOffset = CGPoint(x: collection.contentOffset.x, y: target)
        moving = false
    }
}

extension RowContext {
    var circumstances: RowCircumstances {
        RowCircumstances(
            parentDriven: parentDriven, roster: roster, mentions: mentions,
            pendingApprovals: pendingApprovals, pendingQuestions: pendingQuestions
        )
    }
}

/// One entry of the list as SwiftUI draws it, at its full height whatever the
/// cell's height happens to be this instant, and telling the list when that
/// height changes.
private struct HostedEntry: View {
    enum Content {
        case earlier
        case row(DisplayRow, RowContext)
        case live(LiveSnapshot, [SubSessionMention])
    }

    let content: Content
    let surroundings: Surroundings?
    let onResize: (CGSize) -> Void

    var body: some View {
        Group {
            switch content {
            case .earlier:
                ProgressView()
                    .tint(Palette.mutedForeground)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            case .row(let row, let context):
                DisplayRowView(row: row, context: context).equatable()
            case .live(let live, let mentions):
                LiveTail(live: live, mentions: mentions)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // As a scroll view would lay it out: the width it is given, and all the
        // height it wants.
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { onResize($0) }
        .frame(maxHeight: .infinity, alignment: .top)
        .modifier(OptionalSurroundings(surroundings: surroundings))
        // A cell passing under the bars must not have its content pushed about
        // by them; the list has already kept it clear.
        .ignoresSafeArea()
    }
}

private struct OptionalSurroundings: ViewModifier {
    let surroundings: Surroundings?

    func body(content: Content) -> some View {
        if let surroundings { content.modifier(surroundings) } else { content }
    }
}

/// The streaming tail: the turn's text as it arrives, before it lands as an event.
private struct LiveTail: View {
    let live: LiveSnapshot
    let mentions: [SubSessionMention]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !live.thinking.isEmpty { LiveThinking(text: live.thinking) }
            if !live.text.isEmpty { Prose(live.text, mentions: mentions) }
        }
        .padding(.top, 6)
    }
}

/// The turn's thinking as it streams, folded away unless asked for.
private struct LiveThinking: View {
    let text: String
    @State private var open = false

    var body: some View {
        Collapsible(name: "Thinking…", open: $open) {
            Brain(color: Palette.mutedForeground)
        } content: {
            Text(text).font(AppFont.sans(13)).foregroundStyle(Palette.foreground).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// A cell is only a frame for a row's hosted view, which it borrows while the
/// row is on screen.
private final class HostCell: UICollectionViewCell {
    private weak var held: UIView?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundConfiguration = .clear()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func hold(_ host: UIView, parking: UIView) {
        if let held, held !== host { release(to: parking) }
        held = host
        host.frame = contentView.bounds
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        contentView.addSubview(host)
    }

    func release(to parking: UIView) {
        // The row may already be in another cell, or gone from the list.
        if let held, held.superview === contentView { parking.addSubview(held) }
        held = nil
    }
}

/// Rows top to bottom at the heights they were measured at, in the reading
/// column. Nothing is estimated, so nothing is corrected later.
private final class StackLayout: UICollectionViewLayout {
    static let spacing: Double = 4
    static let padding: Double = 16
    /// Between the text column's safe edge and the scroll bar.
    static let indicatorGap: CGFloat = 2

    var stack = TranscriptStack(heights: [], spacing: spacing, padding: padding)
    var column: (x: Double, width: Double) = (0, 0)
    private var attributes: [UICollectionViewLayoutAttributes] = []

    override func prepare() {
        super.prepare()
        guard let collectionView, collectionView.numberOfSections > 0 else {
            attributes = []
            return
        }
        // The stack is set before the snapshot that matches it is applied; in
        // between, draw no more rows than the collection view knows about.
        let count = min(stack.count, collectionView.numberOfItems(inSection: 0))
        attributes = (0..<count).map { index in
            let item = UICollectionViewLayoutAttributes(forCellWith: IndexPath(item: index, section: 0))
            item.frame = CGRect(x: column.x, y: stack.tops[index], width: column.width, height: stack.heights[index])
            return item
        }
    }

    override var collectionViewContentSize: CGSize {
        CGSize(width: collectionView?.bounds.width ?? 0, height: stack.contentHeight)
    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        let range = stack.indices(overlapping: rect.minY, rect.maxY)
        let end = min(range.upperBound, attributes.count)
        guard range.lowerBound < end else { return [] }
        return Array(attributes[range.lowerBound..<end])
    }

    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        attributes.indices.contains(indexPath.item) ? attributes[indexPath.item] : nil
    }

    /// The list sets the column itself when the width changes, measuring first.
    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool { false }
}
#endif
