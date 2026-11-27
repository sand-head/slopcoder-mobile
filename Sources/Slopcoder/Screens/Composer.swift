#if canImport(UIKit)
import PhotosUI
import SlopcoderCore
import SwiftUI

/// What the composer may attach: repositories and remote nodes.
struct Attachments {
    var repos: [String]
    var nodes: [String]
    var recentRepos: [RepoChoice]
    var ownedRepos: [RepoChoice]
    var ownedLoaded: Bool
    var ownedError: String?
    var availableNodes: [SheetOption]
    var searchRepos: (String) async -> [RepoChoice]
    var onChange: (_ repos: [String], _ nodes: [String]) -> Void
}

/// The photos riding the next prompt.
struct ComposerImages {
    var pending: [PendingImage]
    var error: String?
    var onAdd: ([PendingImage], String?) -> Void
    var onRemove: (String) -> Void
}

/// The slash menu's commands, asked for the first time a slash is typed.
struct ComposerCommands {
    var list: [SlashCommandInfo]
    var onNeeded: () -> Void
}

private enum ComposerSheet: String, Identifiable {
    case model, turn, attach
    var id: String { rawValue }
}

/// The one way to say something to an agent: on the sessions page it starts a
/// session, in a session it sends or steers.
///
/// The toolbar is one line: attach, turn settings, the dials that are off their
/// default, and send. A dial at its default is not drawn — "Auto · Auto ·
/// Dangerous only" on every composer is three chips saying nothing.
struct Composer: View {
    var launcher = false
    @Binding var text: String
    let placeholder: String
    /// "Start", "Send" or "Steer" — spoken, since the button is an arrow.
    let action: String
    let onAction: () -> Void
    var busy = false
    var disabled = false
    var running = false
    var onStop: (() -> Void)?
    var stopping = false
    @Binding var options: TurnOptions
    let models: [ModelCandidate]
    /// The model an Auto session last routed to, whose dial this one follows.
    var routed: (connectionId: String?, modelId: String?)?
    let facets: [FacetOption]
    var attachments: Attachments?
    var images: ComposerImages?
    var commands: ComposerCommands?
    var sessionStatus: String?
    /// A tap on the status line: go to whatever the turn is waiting on.
    var onStatusTap: (() -> Void)?

    @Environment(ConnectionStatus.self) private var connection
    @State private var sheet: ComposerSheet?
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var pickingPhotos = false
    @State private var takingPhoto = false
    @FocusState private var focused: Bool

    private var dials: TurnDials { TurnDials(options: options, models: models, routed: routed) }
    private var current: ModelCandidate? { dials.current }
    private var caps: ThinkingCaps? { dials.caps }
    private var modelLabel: String { dials.modelLabel }
    private var shownThinking: ThinkingLevel? { dials.shownThinking }

    private var room: Int { ImageRules.maxImages - (images?.pending.count ?? 0) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let commands { SlashMenu(commands: commands, draft: text) { name in
                Haptics.select()
                text = "/\(name) "
            } }

            if launcher { card } else { pill }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .model: modelSheet
            case .turn: turnSheet
            case .attach:
                if let attachments { AttachSheet(attachments: attachments) }
            }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photoItems, maxSelectionCount: max(1, room), matching: .images)
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty, let images else { return }
            let space = room
            photoItems = []
            Task {
                let loaded = await ImageEncoding.load(items, room: space)
                images.onAdd(loaded.images, loaded.error)
            }
        }
        .fullScreenCover(isPresented: $takingPhoto) {
            CameraPicker { image in
                takingPhoto = false
                guard let image, let images else { return }
                switch ImageEncoding.pending(from: image) {
                case .success(let pending): images.onAdd([pending], nil)
                case .failure(let reason): images.onAdd([], reason.message)
                }
            }
            .ignoresSafeArea()
        }
    }

    /// The launcher: a card with room to write a brief, and its dials on show.
    private var card: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let sessionStatus {
                if let onStatusTap {
                    Button(action: onStatusTap) { Mono(sessionStatus, color: Status.running) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(sessionStatus). Jump to current request")
                } else {
                    Mono(sessionStatus)
                }
            }
            chips
            if let error = images?.error { Text(error).font(AppFont.sans(12)).foregroundStyle(Palette.destructive) }

            TextField(connection.reachable ? placeholder : "Offline", text: $text, axis: .vertical)
                .font(AppFont.sans(16))
                .foregroundStyle(Palette.foreground)
                .lineLimit(launcher ? 3...12 : 1...8)
                .focused($focused)
                .accessibilityIdentifier("composer.field")
                .padding(.vertical, 4)
                .accessibilityLabel(placeholder)

            toolbar
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .glassSurface(cornerRadius: Radius.xl)
    }

    /// In a session: one line that grows, as a chat composer is everywhere else.
    /// Attach on the left, send on the right. The model and the turn's dials are
    /// the session's, not the message's, and live with the session: behind its
    /// title.
    private var pill: some View {
        VStack(alignment: .leading, spacing: 6) {
            // "Idle" is the absence of news; only say what is happening.
            if let sessionStatus, sessionStatus != "Idle" {
                Group {
                    if let onStatusTap {
                        Button(action: onStatusTap) { Mono(sessionStatus, color: Status.running) }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(sessionStatus). Jump to current request")
                    } else {
                        Mono(sessionStatus)
                    }
                }
                .padding(.horizontal, 14)
            }
            chips
            if let error = images?.error {
                Text(error).font(AppFont.sans(12)).foregroundStyle(Palette.destructive).padding(.horizontal, 14)
            }

            HStack(alignment: .bottom, spacing: 2) {
                plusMenu
                TextField(connection.reachable ? placeholder : "Offline", text: $text, axis: .vertical)
                    .font(AppFont.sans(16))
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1...8)
                    .focused($focused)
                    .accessibilityIdentifier("composer.field")
                    .padding(.vertical, 11)
                    .padding(.horizontal, 4)
                    .accessibilityLabel(placeholder)
                if running, let onStop {
                    SendButton(mode: .stop, busy: stopping, disabled: !connection.reachable, label: stopping ? "Stopping" : "Stop", action: onStop)
                }
                SendButton(mode: .send, busy: busy, disabled: disabled || !connection.reachable, label: action, action: onAction)
                    .accessibilityIdentifier("composer.send")
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 3)
            .glassSurface(cornerRadius: 25)
        }
    }

    private var plusMenu: some View {
        Menu {
            if images != nil {
                Button {
                    if room > 0 { pickingPhotos = true } else { images?.onAdd([], ImageRules.tooMany) }
                } label: { Label("Photo Library", systemImage: "photo.on.rectangle") }
                Button {
                    if room <= 0 {
                        images?.onAdd([], ImageRules.tooMany)
                    } else if CameraPicker.available {
                        takingPhoto = true
                    } else {
                        images?.onAdd([], "No camera on this device.")
                    }
                } label: { Label("Take Photo", systemImage: "camera") }
            }
            if attachments != nil {
                Button { sheet = .attach } label: { Label("Repositories & nodes", systemImage: "folder") }
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(Palette.foreground)
                .frame(width: 36, height: 36)
                .background(Palette.mutedForeground.opacity(0.14), in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("Attach")
    }

    @ViewBuilder private var chips: some View {
        let repos = attachments?.repos ?? []
        let nodes = attachments?.nodes ?? []
        let pending = images?.pending ?? []
        if !repos.isEmpty || !nodes.isEmpty || !pending.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    if let attachments { AttachChips(attachments: attachments) }
                    if let images { ImageChips(images: images) }
                }
            }
            .accessibilityLabel("Selected context")
        }
    }

    private var toolbar: some View {
        HStack(spacing: 6) {
            if attachments != nil || images != nil {
                if images != nil {
                    Menu {
                        Button {
                            if room > 0 { pickingPhotos = true } else { images?.onAdd([], ImageRules.tooMany) }
                        } label: { Label("Photo Library", systemImage: "photo.on.rectangle") }
                        Button {
                            if room <= 0 {
                                images?.onAdd([], ImageRules.tooMany)
                            } else if CameraPicker.available {
                                takingPhoto = true
                            } else {
                                images?.onAdd([], "No camera on this device.")
                            }
                        } label: { Label("Take Photo", systemImage: "camera") }
                        if attachments != nil {
                            Button { sheet = .attach } label: { Label("Repositories & nodes", systemImage: "folder") }
                        }
                    } label: {
                        ComposerIcon(systemName: "plus")
                    }
                    .accessibilityLabel("Attach")
                } else {
                    Button { sheet = .attach } label: { ComposerIcon(systemName: "plus") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Attach")
                }
            }

            Button { sheet = .turn } label: { ComposerIcon(systemName: "slider.horizontal.3") }
                .buttonStyle(.plain)
                .accessibilityLabel("Turn settings")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    // The launcher shows a model only once one has been chosen;
                    // a session always says which it is on.
                    if !launcher || !options.selection.auto {
                        Pill(label: modelLabel, muted: launcher) { sheet = .model }
                    }
                    if let shownThinking {
                        Pill(label: levelLabel(shownThinking, caps), muted: true) { sheet = .turn }
                    }
                    if options.approval != .dangerous {
                        Pill(label: ApprovalChoice.label(for: options.approval), muted: true) { sheet = .turn }
                    }
                }
                .frame(minHeight: 44)
            }
            .frame(maxWidth: .infinity)

            if running, let onStop {
                SendButton(mode: .stop, busy: stopping, disabled: !connection.reachable, label: stopping ? "Stopping" : "Stop", action: onStop)
            }
            SendButton(mode: .send, busy: busy, disabled: disabled || !connection.reachable, label: action, action: onAction)
                .accessibilityIdentifier("composer.send")
        }
    }

    private var modelSheet: some View {
        AppSheet(title: "Select model") {
            ModelPicker(options: $options, models: models) { sheet = nil }
        }
    }

    private var turnSheet: some View {
        AppSheet(title: "Turn settings") {
            if launcher {
                Button { sheet = .model } label: {
                    HStack {
                        BodyText("Model: \(modelLabel)")
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.mutedForeground)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            TurnSettingsFields(options: $options, dials: dials, facets: facets)
        }
    }

    static func modelKey(_ connectionId: String, _ modelId: String) -> String {
        "\(connectionId)/\(modelId)"
    }
}

/// Auto, then every model on every connection.
struct ModelPicker: View {
    @Binding var options: TurnOptions
    let models: [ModelCandidate]
    var onPicked: () -> Void = {}

    var body: some View {
        let ordered = orderModels(models)
        let choices = [SheetOption(key: "auto", label: "Auto", description: "Let the router pick per turn")]
            + ordered.map { model in
                SheetOption(
                    key: Composer.modelKey(model.connectionId, model.modelId),
                    label: model.modelDisplayName.isEmpty ? model.modelId : model.modelDisplayName,
                    description: model.connectionName
                )
            }
        let current = options.selection.auto
            ? nil
            : findCandidate(models, connectionId: options.selection.connectionId, modelId: options.selection.modelId)
        let selected = current.map { Composer.modelKey($0.connectionId, $0.modelId) } ?? "auto"
        SheetGroup(options: choices, selected: selected) { key in
            // Keyed by connection and id: the same model on two connections
            // is two rows, and must not collide.
            if let picked = models.first(where: { Composer.modelKey($0.connectionId, $0.modelId) == key }) {
                options.selection = ModelSelection(auto: false, connectionId: picked.connectionId, modelId: picked.modelId)
            } else {
                options.selection = .autoRoute
            }
            onPicked()
        }
        if models.isEmpty { Mono("No providers connected yet.") }
    }
}

/// Thinking, approvals and facet: the dials of a turn.
struct TurnSettingsFields: View {
    @Binding var options: TurnOptions
    let dials: TurnDials
    let facets: [FacetOption]

    var body: some View {
        let caps = dials.caps
        let offered = offeredLevels(caps)
        SheetSegments(
            label: "thinking",
            options: [SheetOption(key: "auto", label: "Auto")] + offered.map { SheetOption(key: levelKey($0), label: levelLabel($0, caps)) },
            selected: dials.shownThinking.map(levelKey) ?? "auto"
        ) { key in
            options.thinking = offered.first { levelKey($0) == key }
        }
        SheetGroup(
            label: "approvals",
            options: ApprovalChoice.all.map { SheetOption(key: $0.key, label: $0.label, description: $0.description) },
            selected: ApprovalChoice.all.first { $0.value == options.approval }?.key ?? "dangerous"
        ) { key in
            options.approval = ApprovalChoice.all.first { $0.key == key }?.value ?? .dangerous
        }
        if !facets.isEmpty {
            SheetGroup(
                label: "facet",
                options: [SheetOption(key: "", label: "Default")] + facets.map { SheetOption(key: $0.name, label: $0.name, description: $0.description) },
                selected: options.facet ?? ""
            ) { key in
                options.facet = key.isEmpty ? nil : key
            }
        }
    }
}

private struct ComposerIcon: View {
    let systemName: String

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 17, weight: .regular))
            .foregroundStyle(Palette.mutedForeground)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
    }
}

private struct Pill: View {
    let label: String
    var muted = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(AppFont.sans(12))
                .foregroundStyle(muted ? Palette.mutedForeground : Palette.foreground)
                .lineLimit(1)
                .padding(.horizontal, 11)
                .frame(height: 30)
                .frame(maxWidth: muted ? 120 : 160)
                .background(Palette.mutedForeground.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// The circular send, and the square stop inside it.
///
/// Losing the word costs something: Send and Steer become the same button, and
/// only the running dot and the placeholder say which one you are pressing. The
/// shape carries the distinction that actually matters — arrow versus square is
/// the convention every chat app has trained people on — and the action word
/// survives as the accessibility label, so it is still spoken aloud.
struct SendButton: View {
    enum Mode { case send, stop }

    let mode: Mode
    var busy = false
    var disabled = false
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().fill(mode == .send ? Palette.primary : Palette.mutedForeground.opacity(0.16))
                if busy {
                    ProgressView().tint(mode == .send ? Palette.primaryForeground : Palette.foreground)
                } else if mode == .send {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Palette.primaryForeground)
                } else {
                    RoundedRectangle(cornerRadius: 2).fill(Palette.foreground).frame(width: 11, height: 11)
                }
            }
            .frame(width: 34, height: 34)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled || busy)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityLabel(label)
    }
}

/// What `/co` offers. Parsing happens here; running happens on the server.
private struct SlashMenu: View {
    let commands: ComposerCommands
    let draft: String
    let onPick: (String) -> Void

    var body: some View {
        let prefix = commandPrefix(draft)
        let matches = prefix.map { matchCommands(commands.list, prefix: $0) } ?? []
        Group {
            if !matches.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(matches, id: \.name) { command in
                            Button { onPick(command.name) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Mono("/\(command.name)", size: 14, color: Palette.primary)
                                    if !command.help.isEmpty {
                                        Text(command.help).font(AppFont.sans(12.5)).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                                    }
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint(command.help)
                        }
                    }
                    .padding(.vertical, 6)
                }
                .frame(maxHeight: 240)
                .fixedSize(horizontal: false, vertical: true)
                .glassSurface(cornerRadius: Radius.xl)
            }
        }
        // Reading the repo's command templates walks the sandbox, so the list is
        // asked for the first time a slash is typed, not when the screen opens.
        .onChange(of: prefix != nil, initial: true) { _, wanted in
            if wanted { commands.onNeeded() }
        }
    }
}

/// Repositories and nodes: recents, your own, then every connected forge.
struct AttachSheet: View {
    let attachments: Attachments
    /// Said under every node, where the sheet has a caveat about them.
    var nodeDescription: String?
    @State private var query = ""
    @State private var found: [RepoChoice] = []
    @State private var searching = false
    @State private var repos: [String]
    @State private var nodes: [String]

    init(attachments: Attachments, nodeDescription: String? = nil) {
        self.attachments = attachments
        self.nodeDescription = nodeDescription
        _repos = State(initialValue: attachments.repos)
        _nodes = State(initialValue: attachments.nodes)
    }

    private func option(_ choice: RepoChoice) -> SheetOption {
        SheetOption(key: choice.key, label: choice.label, description: choice.description, kind: choice.kind, showsMark: true)
    }

    var body: some View {
        let offered = offer(query: query, recent: attachments.recentRepos, owned: attachments.ownedRepos, found: found, searching: searching)
        AppSheet(title: "Attach", detents: [.large]) {
            AppField(placeholder: "Search repositories…", text: $query)
            // A half-failed listing is said, not shown as a short list.
            if let error = attachments.ownedError { Mono(error, color: Palette.destructive) }
            SheetMultiGroup(label: offered.label, options: offered.options.map(option), selected: repos, empty: offered.empty) { key in
                if let index = repos.firstIndex(of: key) { repos.remove(at: index) } else { repos.append(key) }
                attachments.onChange(repos, nodes)
            }
            SheetMultiGroup(
                label: "remote nodes",
                options: attachments.availableNodes.map { node in
                    var node = node
                    if let nodeDescription { node.description = nodeDescription }
                    return node
                },
                selected: nodes
            ) { key in
                if let index = nodes.firstIndex(of: key) { nodes.remove(at: index) } else { nodes.append(key) }
                attachments.onChange(repos, nodes)
            }
        }
        // Debounced, and only once nothing of yours matches: the search is an
        // expansion, not the first resort.
        .task(id: query) {
            found = []
            guard shouldSearch(attachments.ownedRepos, query: query, ownedLoaded: attachments.ownedLoaded) else {
                searching = false
                return
            }
            searching = true
            try? await Task.sleep(nanoseconds: 300_000_000)
            if Task.isCancelled { return }
            let rows = await attachments.searchRepos(query.trimmingCharacters(in: .whitespaces))
            if Task.isCancelled { return }
            found = rows
            searching = false
        }
    }
}

struct AttachChips: View {
    let attachments: Attachments

    var body: some View {
        HStack(spacing: 6) {
            ForEach(attachments.repos, id: \.self) { url in
                let known = attachments.recentRepos.first { $0.key == url } ?? attachments.ownedRepos.first { $0.key == url }
                chip(label: known?.label ?? shortRepo(url), kind: known?.kind ?? kindFromUrl(url), mark: true) {
                    attachments.onChange(attachments.repos.filter { $0 != url }, attachments.nodes)
                }
            }
            ForEach(attachments.nodes, id: \.self) { id in
                chip(label: attachments.availableNodes.first { $0.key == id }?.label ?? "node", kind: nil, mark: false) {
                    attachments.onChange(attachments.repos, attachments.nodes.filter { $0 != id })
                }
            }
        }
    }

    private func chip(label: String, kind: GitServiceKind?, mark: Bool, drop: @escaping () -> Void) -> some View {
        Button(action: drop) {
            HStack(spacing: 6) {
                if mark { GitMark(kind: kind, size: 12, color: kind == nil ? Palette.mutedForeground : Palette.foreground) }
                Mono(label, size: 11.5, color: Palette.foreground).lineLimit(1).frame(maxWidth: 160)
                Mono("×", size: 12)
            }
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(Palette.card, in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(label)")
    }
}

struct ImageChips: View {
    let images: ComposerImages

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(images.pending.enumerated()), id: \.element.id) { index, pending in
                Button { images.onRemove(pending.key) } label: {
                    ZStack(alignment: .topTrailing) {
                        if let image = ImageEncoding.image(pending) {
                            Image(uiImage: image).resizable().scaledToFill().frame(width: 56, height: 56).clipped()
                        } else {
                            Palette.muted.frame(width: 56, height: 56)
                        }
                        Text("×")
                            .font(AppFont.mono(11))
                            .foregroundStyle(Palette.background)
                            .frame(width: 16, height: 16)
                            .background(Palette.foreground.opacity(0.7), in: Circle())
                            .padding(3)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove image \(index + 1) of \(images.pending.count)")
            }
            if images.pending.count >= ImageRules.maxImages {
                Mono("\(ImageRules.maxImages) of \(ImageRules.maxImages)", size: 11)
            }
        }
    }
}
#endif
