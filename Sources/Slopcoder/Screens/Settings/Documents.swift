#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

// The pages that are lists of documents — facets, skills, memory, hooks and
// permission rules — and the one editor they share.

/// What the document editor is editing.
enum DocTarget: Identifiable {
    case facet(UserFacetSummary?)
    case skill(UserSkillSummary?)
    case memory(MemorySummary?)
    case hooks
    case permissions

    var id: String {
        switch self {
        case .facet(let entry): return "facet:\(entry?.id ?? "")"
        case .skill(let entry): return "skill:\(entry?.id ?? "")"
        case .memory(let entry): return "memory:\(entry?.id ?? "")"
        case .hooks: return "hooks"
        case .permissions: return "permissions"
        }
    }
}

// MARK: - facets

struct FacetsPage: View {
    @Environment(AppModel.self) private var model
    @State private var facets: [UserFacetSummary]?
    @State private var error: String?
    @State private var confirmation: Confirmation?
    @State private var editing: DocTarget?

    var body: some View {
        SettingsScroll(error: error, loading: facets == nil && error == nil, onRefresh: load) {
            Hint("Personal personas, available in every session. Precedence: repo facets beat these; these beat the shipped plan/execute.")
            SettingsSection(label: "facets", count: facets?.count) {
                if facets?.isEmpty == true { Hint("No personal facets yet.").padding(.vertical, 8) }
                ForEach(facets ?? []) { facet in
                    ListRow(
                        title: facet.name, subtitle: "updated \(SettingsLogic.stamp(facet.updatedAt))", chevron: true,
                        menu: [
                            RowAction(title: "Edit", symbol: "pencil") { editing = .facet(facet) },
                            RowAction(title: "Delete", symbol: "trash", destructive: true) {
                                confirmation = Confirmation(
                                    title: "Delete ‘\(facet.name)’?", message: "Sessions using it fall back to the default facet.",
                                    action: "Delete"
                                ) {
                                    Task { await remove(facet) }
                                }
                            },
                        ],
                        onTap: { editing = .facet(facet) }
                    )
                }
            }
        }
        .navigationTitle("Facets")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { editing = .facet(nil) } label: { Image(systemName: "plus") }.accessibilityLabel("New facet")
            }
        }
        .confirms($confirmation)
        .task { await load() }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { DocEditor(target: $0) }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            facets = try await seam.userFacets()
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    private func remove(_ facet: UserFacetSummary) async {
        guard let seam = model.seam else { return }
        do {
            _ = try await seam.deleteFacet(facet.id)
            Haptics.confirm()
        } catch {
            Haptics.error()
        }
        await load()
    }
}

// MARK: - skills

struct SkillsPage: View {
    @Environment(AppModel.self) private var model
    @State private var skills: [UserSkillSummary]?
    @State private var error: String?
    @State private var confirmation: Confirmation?
    @State private var editing: DocTarget?

    var body: some View {
        SettingsScroll(error: error, loading: skills == nil && error == nil, onRefresh: load) {
            Hint("Procedures the agent can load on demand, available in every session. The agent writes these itself with save_skill after working something out; yours win over a repository's skill of the same name.")
            SettingsSection(label: "skills", count: skills?.count) {
                if skills?.isEmpty == true {
                    Hint("No skills saved yet. The agent writes them as it learns procedures.").padding(.vertical, 8)
                }
                ForEach(skills ?? []) { skill in
                    let description = SettingsLogic.describeSkill(skill.content)
                    let stamp = SettingsLogic.stamp(skill.updatedAt)
                    ListRow(
                        title: skill.name, subtitle: description.isEmpty ? "updated \(stamp)" : "\(description) · \(stamp)",
                        chevron: true,
                        menu: [
                            RowAction(title: "Edit", symbol: "pencil") { editing = .skill(skill) },
                            RowAction(title: "Delete", symbol: "trash", destructive: true) {
                                confirmation = Confirmation(
                                    title: "Delete ‘\(skill.name)’?",
                                    message: "The agent can write it again if it works the procedure out afresh.", action: "Delete"
                                ) {
                                    Task { await remove(skill) }
                                }
                            },
                        ],
                        onTap: { editing = .skill(skill) }
                    )
                }
            }
        }
        .navigationTitle("Skills")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { editing = .skill(nil) } label: { Image(systemName: "plus") }.accessibilityLabel("New skill")
            }
        }
        .confirms($confirmation)
        .task { await load() }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { DocEditor(target: $0) }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            skills = try await seam.skills()
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    private func remove(_ skill: UserSkillSummary) async {
        guard let seam = model.seam else { return }
        do {
            _ = try await seam.deleteSkill(skill.id)
            Haptics.confirm()
        } catch {
            Haptics.error()
        }
        await load()
    }
}

// MARK: - memory

struct MemoryPage: View {
    @Environment(AppModel.self) private var model
    @State private var entries: [MemorySummary]?
    @State private var error: String?
    @State private var confirmation: Confirmation?
    @State private var editing: DocTarget?

    var body: some View {
        SettingsScroll(error: error, loading: entries == nil && error == nil, onRefresh: load) {
            Hint("What the agent remembers across sessions. User-scoped entries apply everywhere; repo-scoped entries only join sessions on that repository. A pinned entry has its whole body in every system prompt instead of a one-line index entry; pin only what the agent must have without asking for it.")
            if entries?.isEmpty == true { Hint("Nothing remembered yet. The agent saves entries as it works.").padding(.vertical, 8) }
            ForEach(SettingsLogic.groupMemories(entries ?? [])) { group in
                SettingsSection(label: group.title, count: group.entries.count) {
                    ForEach(group.entries) { entry in
                        ListRow(
                            title: entry.name,
                            subtitle: entry.description.isEmpty ? "updated \(SettingsLogic.stamp(entry.updatedAt))" : entry.description,
                            tag: entry.pinned ? "pinned" : nil, tagTone: .ok, chevron: true,
                            menu: [
                                RowAction(title: entry.pinned ? "Unpin" : "Pin", symbol: entry.pinned ? "pin.slash" : "pin") {
                                    Task { await togglePin(entry) }
                                },
                                RowAction(title: "Edit", symbol: "pencil") { editing = .memory(entry) },
                                RowAction(title: "Delete", symbol: "trash", destructive: true) {
                                    confirmation = Confirmation(
                                        title: "Delete ‘\(entry.name)’?",
                                        message: "The agent forgets it; it may save it again if it learns it afresh.", action: "Delete"
                                    ) {
                                        Task { await run { _ = try await $0.deleteMemory(entry.id) } }
                                    }
                                },
                            ],
                            onTap: { editing = .memory(entry) }
                        )
                    }
                }
            }
        }
        .navigationTitle("Memory")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { editing = .memory(nil) } label: { Image(systemName: "plus") }.accessibilityLabel("New entry")
            }
        }
        .confirms($confirmation)
        .task { await load() }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { DocEditor(target: $0) }
    }

    private func togglePin(_ entry: MemorySummary) async {
        await run {
            try await $0.saveMemory(SaveMemoryRequest(
                repoKey: entry.repoKey, name: entry.name, description: entry.description, content: entry.content,
                pinned: !entry.pinned
            ))
        }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            entries = try await seam.memories()
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    private func run(_ command: (Seam) async throws -> Void) async {
        guard let seam = model.seam else { return }
        do {
            try await command(seam)
            Haptics.confirm()
        } catch {
            Haptics.error()
        }
        await load()
    }
}

// MARK: - hooks and permission rules

struct HooksPage: View {
    @Environment(AppModel.self) private var model
    @State private var hooks: String?
    @State private var permissions: String?
    @State private var loaded = false
    @State private var error: String?
    @State private var editing: DocTarget?

    var body: some View {
        SettingsScroll(error: error, loading: !loaded && error == nil, onRefresh: load) {
            Hint("Your global lifecycle hooks and permission rules, merged with each repo's own .slopcoder files. Handlers run inside the session's sandbox; only rules saved here may allow a tool past the approval gate.")
            SettingsSection(label: "documents") {
                ListRow(
                    title: "Hooks", subtitle: "hooks.json · \(SettingsLogic.checkHooks(hooks ?? "").message)", chevron: true,
                    onTap: { editing = .hooks }
                )
                ListRow(
                    title: "Permission rules", subtitle: "permissions.yaml · \(describeRules(permissions))", chevron: true,
                    onTap: { editing = .permissions }
                )
            }
        }
        .navigationTitle("Hooks")
        .task { await load() }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { DocEditor(target: $0) }
    }

    private func describeRules(_ yaml: String?) -> String {
        let lines = (yaml ?? "").split(separator: "\n", omittingEmptySubsequences: false).filter { !String($0).jsTrim.isEmpty }.count
        return lines == 0 ? "empty" : "\(lines) line\(lines == 1 ? "" : "s")"
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            hooks = try await seam.hooks()
            permissions = try await seam.permissions()
            loaded = true
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }
}

// MARK: - the editor

private let hooksPlaceholder = "{\n  \"pre_tool_use\": [{ \"matcher\": \"run_bash\", \"command\": \"./hooks/check.sh\", \"timeout\": 30 }]\n}"
private let permissionsPlaceholder = "rules:\n  - action: allow\n    tool: run_bash\n    executable: git\n    subcommand: push"

/// One editor for every document: a named one (facet, skill, memory entry) or a
/// whole file (hooks, permission rules). The ones with a grammar are checked
/// before they are saved.
struct DocEditor: View {
    let target: DocTarget
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var repoKey: String
    @State private var description: String
    @State private var content: String
    @State private var pinned: Bool
    @State private var loaded: Bool
    @State private var original: [String]
    @State private var busy = false
    @State private var note: (ok: Bool, text: String)?
    @State private var error: String?
    private let editingName: String?

    init(target: DocTarget) {
        self.target = target
        var name = "", repoKey = "", description = "", content = "", pinned = false
        var existing: String?
        switch target {
        case .facet(let entry):
            name = entry?.name ?? ""
            content = entry?.content ?? ""
            existing = entry?.name
        case .skill(let entry):
            name = entry?.name ?? ""
            content = entry?.content ?? ""
            existing = entry?.name
        case .memory(let entry):
            name = entry?.name ?? ""
            content = entry?.content ?? ""
            repoKey = entry?.repoKey ?? ""
            description = entry?.description ?? ""
            pinned = entry?.pinned ?? false
            existing = entry?.name
        case .hooks, .permissions:
            break
        }
        editingName = existing
        _name = State(initialValue: name)
        _repoKey = State(initialValue: repoKey)
        _description = State(initialValue: description)
        _content = State(initialValue: content)
        _pinned = State(initialValue: pinned)
        _original = State(initialValue: [name, repoKey, description, content, String(pinned)])
        if case .hooks = target { _loaded = State(initialValue: false) } else if case .permissions = target {
            _loaded = State(initialValue: false)
        } else {
            _loaded = State(initialValue: true)
        }
    }

    private enum Kind { case facet, skill, memory, hooks, permissions }

    private var kind: Kind {
        switch target {
        case .facet: return .facet
        case .skill: return .skill
        case .memory: return .memory
        case .hooks: return .hooks
        case .permissions: return .permissions
        }
    }

    private var isDocument: Bool { kind == .hooks || kind == .permissions }
    private var named: Bool { !isDocument }
    private var dirty: Bool { [name, repoKey, description, content, String(pinned)] != original }
    private var ready: Bool { loaded && !busy && (!named || (!name.jsTrim.isEmpty && !content.jsTrim.isEmpty)) }

    private var title: String {
        switch kind {
        case .facet: return editingName.map { "Edit ‘\($0)’" } ?? "New facet"
        case .skill: return editingName.map { "Edit ‘\($0)’" } ?? "New skill"
        case .memory: return editingName.map { "Edit ‘\($0)’" } ?? "New entry"
        case .hooks: return "Hooks"
        case .permissions: return "Permission rules"
        }
    }

    var body: some View {
        EditorSheet(title: title, confirm: "Save", ready: ready, dirty: dirty, error: error, onConfirm: { Task { await save() } }) {
            if kind == .hooks {
                Hint("Your global lifecycle hooks, merged with each repo's .slopcoder/hooks.json (all handlers run; handlers execute inside the session's sandbox). Events: session_start, pre_tool_use, post_tool_use, post_tool_use_failure, stop. Exit 0 = proceed (optional JSON verdict on stdout); exit 2 = block-with-output.")
            }
            if kind == .permissions {
                Hint("Your global allow/ask/deny rules, merged with each repo's .slopcoder/permissions.yaml. This is the trusted layer: only rules saved here may allow (skip the approval gate) — repo files can tighten with deny/ask but never loosen.")
            }
            if named {
                FormField(
                    label: "name", text: $name,
                    placeholder: kind == .facet ? "docs-writer" : kind == .skill ? "monthly-invoices" : "build-quirks",
                    hint: editingName == nil ? nil : "A name cannot change; make a new one and delete this.",
                    editable: editingName == nil
                )
            }
            if kind == .memory {
                FormField(label: "repo key", text: $repoKey, placeholder: "host/owner/name — blank for user scope", editable: editingName == nil)
                FormField(
                    label: "description", text: $description, placeholder: "one line, shown in the agent's memory index",
                    capitalization: .sentences
                )
            }
            CodeBox(
                label: kind == .memory ? "entry (markdown)" : kind == .hooks ? "hooks.json" : kind == .permissions ? "permissions.yaml" : "content",
                text: $content, placeholder: placeholder, minHeight: isDocument ? 320 : 220, editable: loaded && !busy
            )
            if kind == .memory {
                SwitchRow(
                    label: "Pin into every prompt", detail: "The whole body in every system prompt, not a one-line index entry.",
                    isOn: $pinned, disabled: busy
                )
            }
            if let note { Note(text: note.text, ok: note.ok) }
            if kind == .facet || isDocument {
                AppButton("Validate", variant: .outline, disabled: !loaded || busy) { Task { _ = await validate() } }
                if isDocument { Hint("Saving an empty document removes your global \(kind == .hooks ? "hooks" : "rules").") }
            }
            if kind == .facet {
                Hint("Same format as a repo's .slopcoder/facets/*.md — frontmatter (description, tools-allow, tools-deny, model, color) then the system-prompt body.")
            }
            if kind == .skill {
                Hint("A SKILL.md: a --- frontmatter block with name and description, then the instructions. Yours win over a repository's skill of the same name.")
            }
        }
        .onChange(of: content) { _, _ in note = nil }
        .task { await loadDocument() }
    }

    private var placeholder: String {
        switch kind {
        case .facet: return SettingsLogic.facetPlaceholder
        case .skill: return SettingsLogic.skillPlaceholder
        case .hooks: return hooksPlaceholder
        case .permissions: return permissionsPlaceholder
        case .memory: return "The full entry."
        }
    }

    private func loadDocument() async {
        guard isDocument, !loaded, let seam = model.seam else { return }
        do {
            content = try await (kind == .hooks ? seam.hooks() : seam.permissions()) ?? ""
            original = [name, repoKey, description, content, String(pinned)]
            loaded = true
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    /// Check the document against its grammar and say what was found. A document
    /// with no grammar is always fine.
    private func validate() async -> Bool {
        guard let seam = model.seam else { return false }
        do {
            switch kind {
            case .hooks:
                let check = SettingsLogic.checkHooks(content)
                note = (check.ok, check.message)
                return check.ok
            case .permissions:
                if content.jsTrim.isEmpty {
                    note = (true, "empty — saving removes your global rules")
                    return true
                }
                let check = try await seam.checkPermissions(yaml: content)
                if let refused = check.error {
                    note = (false, "Invalid YAML: \(refused)")
                    return false
                }
                note = (true, "valid YAML with \(check.ruleCount) rule\(check.ruleCount == 1 ? "" : "s")")
                return true
            case .facet:
                let check = try await seam.checkFacet(name: name.jsTrim, content: content)
                if let refused = check.error {
                    note = (false, "Invalid: \(refused).")
                    return false
                }
                var text = "parses as facet ‘\(check.name ?? "")’"
                if check.toolsAllowed > 0 { text += ", allows \(check.toolsAllowed) tools" }
                if check.toolsDenied > 0 { text += ", denies \(check.toolsDenied) tools" }
                if let pinnedModel = check.model, !pinnedModel.isEmpty { text += ", pinned to \(pinnedModel)" }
                note = (true, text)
                return true
            case .skill, .memory:
                return true
            }
        } catch {
            self.error = problemText(error)
            return false
        }
    }

    private func save() async {
        guard let seam = model.seam, !busy else { return }
        busy = true
        defer { busy = false }
        error = nil
        guard await validate() else {
            Haptics.error()
            return
        }
        do {
            switch kind {
            case .facet:
                try await seam.saveFacet(name: name.jsTrim, content: content)
            case .skill:
                if let refused = try await seam.saveSkill(name: name.jsTrim, content: content) {
                    Haptics.error()
                    error = refused
                    return
                }
            case .memory:
                try await seam.saveMemory(SaveMemoryRequest(
                    repoKey: repoKey.jsTrim.lowercased(), name: name.jsTrim, description: description.jsTrim,
                    content: content, pinned: pinned
                ))
            case .hooks:
                try await seam.saveHooks(json: content)
            case .permissions:
                try await seam.savePermissions(yaml: content)
            }
            Haptics.confirm()
            dismiss()
        } catch {
            Haptics.error()
            self.error = problemText(error)
        }
    }
}

// MARK: - API keys

struct ApiKeysPage: View {
    @Environment(AppModel.self) private var model
    @State private var keys: [ApiKeySummary]?
    @State private var error: String?
    @State private var busy = false
    @State private var name = ""
    @State private var minted: MintedKey?
    @State private var pairing: DevicePairingCode?
    @State private var left = 0
    @State private var confirmation: Confirmation?
    @State private var notice: Notice?

    private struct MintedKey: Identifiable {
        let id = UUID()
        let key: String
    }

    var body: some View {
        SettingsScroll(error: error, loading: keys == nil && error == nil, onRefresh: load) {
            Hint("Bearer keys for the headless exec API. POST /api/exec with a prompt starts an unattended session (approvals off, questions auto-dismissed, bounded iterations); GET /api/exec/<id>?wait=60 polls for the answer.")
            SettingsSection(label: "keys", count: keys?.count) {
                if keys?.isEmpty == true { Hint("No API keys yet.").padding(.vertical, 8) }
                ForEach(keys ?? []) { key in
                    ListRow(
                        title: key.name,
                        subtitle: "\(key.prefix)… · created \(SettingsLogic.day(key.createdAt)) · last used \(key.lastUsedAt.map { SettingsLogic.stamp($0) } ?? "never")",
                        menu: [RowAction(title: "Revoke", symbol: "trash", destructive: true) { revoke(key) }]
                    )
                }
            }
            SettingsSection(label: "pair a device") {
                VStack(alignment: .leading, spacing: 10) {
                    Hint("Point the slopcoder app on another device at this code and it mints a key of its own. The code works once, for 90 seconds — it is not a key.")
                    if let pairing {
                        Text(pairing.code)
                            .font(AppFont.mono(34))
                            .kerning(6)
                            .foregroundStyle(Palette.foreground)
                            .textSelection(.enabled)
                        Mono("Expires in \(left)s", size: 11.5)
                        AppButton("New code", variant: .outline, disabled: busy) { Task { await pair() } }
                    } else {
                        AppButton("Show pairing code", busy: busy) { Task { await pair() } }
                    }
                }
            }
            SettingsSection(label: "mint a key") {
                VStack(alignment: .leading, spacing: 10) {
                    AppField(placeholder: "What is it for? (e.g. CI)", text: $name, onSubmit: { Task { await mint() } })
                        .textInputAutocapitalization(.sentences)
                        .accessibilityLabel("Key name")
                    AppButton("Mint key", busy: busy, disabled: name.jsTrim.isEmpty) { Task { await mint() } }
                }
            }
        }
        .navigationTitle("API keys")
        .confirms($confirmation)
        .tells($notice)
        .task { await load() }
        .task(id: pairing?.code) {
            // Count the code down, and take it away when it has run out.
            guard let expiresAt = pairing?.expiresAt else { return }
            while !Task.isCancelled {
                left = SettingsLogic.secondsLeft(expiresAt)
                if left == 0 {
                    pairing = nil
                    return
                }
                try? await Task.sleep(for: .seconds(1))
            }
        }
        .sheet(item: $minted) { item in
            AppSheet(title: "Copy this key now") {
                Meta("it is shown exactly once")
                CopyBox(value: item.key)
                ShareLink(item: item.key) {
                    Text("Share").font(AppFont.sansMedium(14)).foregroundStyle(Palette.primary)
                }
            }
        }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            keys = try await seam.apiKeys()
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    private func mint() async {
        let wanted = name.jsTrim
        guard let seam = model.seam, !wanted.isEmpty, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            guard let result = try await seam.mintApiKey(name: wanted) else {
                notice = Notice(title: "Could not mint a key", message: "The server minted no key.")
                return
            }
            Haptics.confirm()
            minted = MintedKey(key: result.fullKey)
            name = ""
            await load()
        } catch {
            Haptics.error()
            notice = Notice(title: "Could not mint a key", message: problemText(error))
        }
    }

    private func pair() async {
        guard let seam = model.seam, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            pairing = try await seam.startPairing()
            Haptics.confirm()
        } catch {
            Haptics.error()
            notice = Notice(title: "Could not issue a code", message: problemText(error))
        }
    }

    private func revoke(_ key: ApiKeySummary) {
        confirmation = Confirmation(
            title: "Revoke ‘\(key.name)’?",
            message: "Anything using it stops working at once. If it is this phone’s key, you are signed out.",
            action: "Revoke"
        ) {
            Task {
                guard let seam = model.seam else { return }
                do { _ = try await seam.revokeApiKey(key.id) } catch { Haptics.error() }
                await load()
            }
        }
    }
}
#endif
