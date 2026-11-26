#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// Model providers and git accounts: which are connected, which are switched
/// on, and — per provider — which models are offered and how capable each is.
struct ConnectionsPage: View {
    @Environment(AppModel.self) private var model
    @State private var connections: [ConnectionSummary]?
    @State private var git: [GitConnectionSummary] = []
    @State private var apps: [GitAppSummary] = []
    @State private var error: String?
    @State private var problem: String?
    @State private var busy = false
    @State private var confirmation: Confirmation?
    @State private var adding: ProviderChoice?
    @State private var codex = false
    @State private var models: ConnectionSummary?

    var body: some View {
        SettingsScroll(error: error ?? problem, loading: connections == nil && error == nil, onRefresh: load) {
            SettingsSection(label: "model providers", count: connections?.count) {
                if connections?.isEmpty == true { Hint("No provider connections yet — add one with +.").padding(.vertical, 8) }
                ForEach(connections ?? []) { connection in
                    ListRow(
                        title: connection.displayName,
                        subtitle: SettingsLogic.connectionMeta(connection),
                        switchValue: connection.enabled,
                        onSwitch: { on in Task { await flip(connection, on) } },
                        disabled: busy,
                        dimmed: !connection.enabled,
                        menu: [
                            RowAction(title: "Models…", symbol: "list.bullet") { open(connection) },
                            RowAction(title: "Remove", symbol: "trash", destructive: true) { remove(connection) },
                        ],
                        onTap: { open(connection) }
                    )
                }
            }
            SettingsSection(label: "git services", count: git.count) {
                if git.isEmpty {
                    Hint("No git accounts connected. Connect GitHub or a Forgejo instance to pick repositories, clone private repos, and let the agent open pull requests — slopcoder never sees your password.")
                        .padding(.vertical, 8)
                }
                ForEach(git) { account in
                    ListRow(
                        title: account.username,
                        subtitle: "\(account.kind == .gitHub ? "GitHub" : "Forgejo") · \(SettingsLogic.gitHost(account)) · connected \(SettingsLogic.day(account.createdAt))",
                        tag: account.trouble == nil ? nil : "reconnect",
                        tagTone: .warn,
                        warn: account.trouble,
                        menu: [RowAction(title: "Disconnect", symbol: "trash", destructive: true) { disconnect(account) }]
                    )
                }
                Group {
                    if apps.isEmpty {
                        Hint("No git service apps are registered yet, so there is nothing to connect to. Ask an administrator to register one.")
                    } else {
                        Hint("Connecting an account is a sign-in with \(apps.map(appLabel).joined(separator: " or ")), and that round trip lands in a browser: open \(model.auth.credential.map { "\($0.server)/settings/connections" } ?? "slopcoder") on a computer and press Connect there. The account shows up here once it is linked.")
                    }
                }
                .padding(.top, 10)
            }
        }
        .navigationTitle("Connections")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    ForEach(SettingsLogic.addableProviders.filter { $0.kind != .kimiCode }, id: \.kind) { choice in
                        Button { adding = choice } label: { Label("\(choice.label) · \(choice.note)", systemImage: "key") }
                    }
                    Button { codex = true } label: { Label("ChatGPT · Codex · subscription", systemImage: "person.crop.circle") }
                    ForEach(SettingsLogic.addableProviders.filter { $0.kind == .kimiCode }, id: \.kind) { choice in
                        Button { adding = choice } label: { Label("\(choice.label) · \(choice.note)", systemImage: "key") }
                    }
                } label: {
                    Label("Add provider", systemImage: "plus")
                }
            }
        }
        .confirms($confirmation)
        .task { await load() }
        .sheet(item: $adding, onDismiss: { Task { await load() } }) { choice in
            ProviderEditor(kind: choice.kind)
        }
        .sheet(isPresented: $codex, onDismiss: { Task { await load() } }) { CodexConnect() }
        .sheet(item: $models, onDismiss: { Task { await load() } }) { connection in
            ModelsSheet(connection: connection)
        }
    }

    private func appLabel(_ app: GitAppSummary) -> String {
        if app.kind == .gitHub { return "GitHub" }
        guard let base = app.baseUrl else { return "Forgejo" }
        return URLComponents(string: base)?.host ?? base
    }

    private func open(_ connection: ConnectionSummary) {
        Haptics.select()
        models = connection
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            async let accounts = try? seam.gitConnections()
            async let registered = try? seam.gitApps()
            connections = try await seam.connections()
            git = await accounts ?? []
            apps = await registered ?? []
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    private func flip(_ connection: ConnectionSummary, _ enabled: Bool) async {
        guard let seam = model.seam else { return }
        if let index = connections?.firstIndex(where: { $0.id == connection.id }) { connections?[index].enabled = enabled }
        busy = true
        problem = nil
        do {
            if try await !seam.setConnectionEnabled(connection.id, enabled: enabled) { problem = "That connection is gone." }
        } catch {
            Haptics.error()
            problem = "Failed to update connection: \(problemText(error))"
        }
        await load()
        busy = false
    }

    private func remove(_ connection: ConnectionSummary) {
        confirmation = Confirmation(
            title: "Remove this connection?",
            message: "“\(connection.displayName)” is removed and its key forgotten; sessions using it can no longer run turns.",
            action: "Remove"
        ) {
            Task { await run { _ = try await $0.deleteConnection(connection.id) } }
        }
    }

    private func disconnect(_ account: GitConnectionSummary) {
        confirmation = Confirmation(
            title: "Disconnect this account?",
            message: "“\(account.username)” is disconnected; repository listing and pull requests through it stop working.",
            action: "Disconnect"
        ) {
            Task { await run { _ = try await $0.deleteGitConnection(account.id) } }
        }
    }

    private func run(_ command: (Seam) async throws -> Void) async {
        guard let seam = model.seam else { return }
        busy = true
        do {
            try await command(seam)
            await load()
        } catch {
            problem = problemText(error)
        }
        busy = false
    }
}

extension ProviderChoice: Identifiable {
    public var id: Int { kind.rawValue }
}

// MARK: - a provider's models

/// Which of a provider's models are offered, and — for an endpoint that could be
/// serving anything — how capable the person says each is.
private struct ModelsSheet: View {
    @State var connection: ConnectionSummary
    @Environment(AppModel.self) private var model
    @State private var options: [ModelOption] = []
    @State private var disabled: Set<String> = []
    @State private var tiers: [String: ModelTier] = [:]
    @State private var error: String?
    @State private var loading = true
    @State private var catalog: String?
    @State private var catalogError: String?
    @State private var catalogBusy = false

    private var compatible: Bool { connection.kind == .openAICompatible }

    var body: some View {
        AppSheet(title: "Models · \(connection.displayName)", detents: [.large]) {
            Mono(
                compatible
                    ? (connection.hasModelCatalog ? "from your catalog · ungraded route as medium" : "ungraded models route as medium")
                    : "graded by the provider"
            )
            if compatible {
                Hint("An OpenAI-compatible endpoint can serve anything under any name, so slopcoder can't judge how capable these models are — only you can. Auto uses your grades to route prompts.")
            }
            if let error { ErrorText(error) }
            if loading { Mono("loading models…") }
            ForEach(options, id: \.id) { option in
                let off = disabled.contains(option.id)
                let tier = tiers[option.id]
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            BodyText(option.displayName).lineLimit(1)
                            if option.displayName != option.id { Mono(option.id).lineLimit(1) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if !compatible, let name = tier?.name { SettingsTag(text: name.lowercased()) }
                        Toggle(
                            "\(option.displayName) enabled",
                            isOn: Binding(get: { !off }, set: { on in Task { await flip(option.id, on) } })
                        )
                        .labelsHidden()
                        .tint(Palette.primary)
                    }
                    if compatible {
                        SheetSegments(
                            label: SettingsLogic.tierLabel(tier),
                            options: SettingsLogic.tiers.map {
                                SheetOption(key: $0.tier.map { String($0.rawValue) } ?? "", label: $0.tier == nil ? "Unrated" : $0.label)
                            },
                            selected: tier.map { String($0.rawValue) } ?? "",
                            onSelect: { key in Task { await grade(option.id, Int(key).map { ModelTier(rawValue: $0) }) } }
                        )
                    }
                }
                .padding(.vertical, 10)
                .topBorder()
                .opacity(off ? 0.55 : 1)
            }
            if compatible { catalogEditor.padding(.top, 12).topBorder() }
        }
        .task { await load() }
    }

    @ViewBuilder private var catalogEditor: some View {
        if catalog != nil {
            VStack(alignment: .leading, spacing: 10) {
                Hint("For endpoints that don't answer GET /models. Paste the Codex models.json your provider documents — a models array of entries with a slug, and optionally display_name, context_window and supported_reasoning_levels. Empty it to go back to asking the endpoint.")
                CodeBox(
                    text: Binding(get: { catalog ?? "" }, set: { catalog = $0 }),
                    placeholder: SettingsLogic.modelCatalogPlaceholder, editable: !catalogBusy
                )
                if let catalogError { ErrorText(catalogError) }
                AppButton(catalogBusy ? "Saving…" : "Save catalog", disabled: catalogBusy) { Task { await saveCatalog() } }
            }
        } else {
            AppButton(connection.hasModelCatalog ? "Edit model catalog" : "Add a model catalog", variant: .outline) {
                Task { await openCatalog() }
            }
        }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        loading = true
        defer { loading = false }
        do {
            let list = try await seam.connectionModels(connection.id)
            if list.isEmpty {
                options = []
                error = connection.kind == .openAICompatible
                    ? "No models came back from that endpoint. If it doesn’t list its own, add a model catalog for it."
                    : connection.kind == .kimiCode
                        ? "Kimi Code didn’t list any models. Check the key, and that the plan still accepts slopcoder as a client."
                        : "That connection is no longer available."
                return
            }
            async let off = seam.disabledModels(connection.id)
            async let grades = seam.connectionTiers(connection.id)
            disabled = Set(try await off)
            tiers = try await grades
            options = list
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = "Couldn't list models: \(problemText(error))"
        }
    }

    private func flip(_ modelId: String, _ enabled: Bool) async {
        guard let seam = model.seam else { return }
        let before = disabled
        if enabled { disabled.remove(modelId) } else { disabled.insert(modelId) }
        do {
            guard try await seam.setModelEnabled(connection.id, modelId: modelId, enabled: enabled) else {
                throw SeamError(status: 404, message: "That connection is gone.")
            }
            Haptics.confirm()
        } catch {
            Haptics.error()
            disabled = before
            self.error = "Failed to update model: \(problemText(error))"
        }
    }

    private func grade(_ modelId: String, _ tier: ModelTier?) async {
        guard let seam = model.seam else { return }
        Haptics.select()
        do {
            _ = try await seam.setModelTier(connection.id, modelId: modelId, tier: tier)
            tiers = try await seam.connectionTiers(connection.id)
        } catch {
            self.error = problemText(error)
        }
    }

    private func openCatalog() async {
        guard let seam = model.seam else { return }
        catalog = ""
        catalogError = nil
        do {
            catalog = try await seam.modelCatalog(connection.id) ?? ""
        } catch {
            catalogError = "Couldn't read the stored catalog: \(problemText(error))"
        }
    }

    private func saveCatalog() async {
        guard let seam = model.seam, let draft = catalog else { return }
        catalogBusy = true
        defer { catalogBusy = false }
        do {
            if let refused = try await seam.setModelCatalog(connection.id, json: draft.jsTrim.isEmpty ? nil : draft) {
                Haptics.error()
                catalogError = refused
                return
            }
            Haptics.confirm()
            catalog = nil
            if let fresh = try await seam.connections().first(where: { $0.id == connection.id }) { connection = fresh }
            await load()
        } catch {
            Haptics.error()
            catalogError = "Couldn't save the catalog: \(problemText(error))"
        }
    }
}

// MARK: - adding a provider

private struct ProviderEditor: View {
    let kind: ProviderKind
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var key = ""
    @State private var baseUrl = ""
    @State private var preset = ""
    @State private var choosingPreset = false
    @State private var error: String?
    @State private var busy = false
    @State private var catalogOpen = false
    @State private var catalog = ""

    private var compatible: Bool { kind == .openAICompatible }

    var body: some View {
        let words = SettingsLogic.providerForm(kind)
        EditorSheet(
            title: words.title, confirm: busy ? "Validating…" : "Validate & add", ready: !busy,
            dirty: !(name.isEmpty && key.isEmpty && baseUrl.isEmpty && catalog.isEmpty), error: error,
            onConfirm: { Task { await submit() } }
        ) {
            Hint(words.description)
            if compatible {
                ChoiceRow(
                    label: "preset", value: preset.isEmpty ? "none" : preset,
                    hint: SettingsLogic.providerPresets.first { $0.name == preset }?.hint
                        ?? "Optional — pick a service to prefill name and base URL.",
                    disabled: busy
                ) { choosingPreset = true }
            }
            if kind == .claudeCode {
                steps([
                    "1. On a machine with a browser and Claude Code installed, run `claude setup-token`.",
                    "2. Sign in to your Claude plan when it opens the browser.",
                    "3. Paste the printed token below. It lasts a year and only authorizes model requests.",
                ], note: "This is for your own plan in your own slopcoder. Anthropic does not allow offering claude.ai login or subscription rate limits to other people through a third-party app, so don't share a Claude Code connection across users.")
            }
            if kind == .kimiCode {
                steps([
                    "1. Open the Kimi Code console (kimi.com/code/console) on the account with your membership.",
                    "2. Create an API key and paste it below. Moonshot Open Platform keys are billed separately and won't work here.",
                    "3. Membership on the overseas site, kimi.ai? Set the base URL to \(KimiCodeEndpoints.overseas).",
                ], note: "Kimi Code only serves coding agents it has whitelisted, which it checks by User-Agent. slopcoder identifies as one by default, which Moonshot hasn't sanctioned and may stop accepting.")
            }
            FormField(label: "name", text: $name, placeholder: words.namePlaceholder, capitalization: .words, editable: !busy)
            FormField(label: words.keyLabel.lowercased(), text: $key, placeholder: words.keyPlaceholder, secure: true, mono: true, editable: !busy)
            if let label = words.baseUrlLabel {
                FormField(label: label.lowercased(), text: $baseUrl, placeholder: words.baseUrlPlaceholder, mono: true, keyboard: .URL, editable: !busy)
            }
            if compatible {
                if catalogOpen {
                    CodeBox(
                        label: "model catalog", text: $catalog, placeholder: SettingsLogic.modelCatalogPlaceholder,
                        hint: "The Codex models.json shape: a models array of entries with a slug, and optionally display_name, context_window and supported_reasoning_levels. slopcoder lists these instead of asking the endpoint.",
                        editable: !busy
                    )
                } else {
                    AppButton("this endpoint doesn't list its models", variant: .ghost, disabled: busy) { catalogOpen = true }
                }
            }
            if busy { BodyText("Validating…", size: 13) }
        }
        .sheet(isPresented: $choosingPreset) {
            AppSheet(title: "Preset") {
                SheetGroup(
                    options: SettingsLogic.providerPresets.map { SheetOption(key: $0.name, label: $0.name, description: $0.baseUrl) },
                    selected: preset,
                    onSelect: { picked in
                        if let found = SettingsLogic.providerPresets.first(where: { $0.name == picked }) {
                            preset = found.name
                            name = found.name
                            baseUrl = found.baseUrl
                        }
                        choosingPreset = false
                    }
                )
            }
        }
    }

    private func steps(_ lines: [String], note: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(lines, id: \.self) { Mono($0, color: Palette.foreground) }
            Hint(note)
        }
    }

    private func submit() async {
        guard let seam = model.seam, !busy else { return }
        if name.jsTrim.isEmpty || key.jsTrim.isEmpty {
            Haptics.error()
            error = kind == .claudeCode ? "A name and the setup token are both required." : "A name and an API key are both required."
            return
        }
        busy = true
        defer { busy = false }
        error = nil
        do {
            let result = try await seam.createConnection(CreateConnectionRequest(
                kind: kind, displayName: name.jsTrim, apiKey: key.jsTrim,
                baseUrl: baseUrl.jsTrim.isEmpty ? nil : baseUrl.jsTrim,
                modelCatalogJson: compatible && !catalog.jsTrim.isEmpty ? catalog : nil
            ))
            guard result.id != nil else {
                Haptics.error()
                error = result.error ?? "The server refused that connection."
                if result.needsModelCatalog == true {
                    catalogOpen = true
                    error = "\(result.error ?? "")\n\nPaste a model catalog below and try again.".jsTrim
                }
                return
            }
            Haptics.confirm()
            dismiss()
        } catch {
            Haptics.error()
            self.error = problemText(error)
        }
    }
}

// MARK: - a ChatGPT subscription

/// Sign in to ChatGPT with a device code, or import a Codex CLI login.
private struct CodexConnect: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var busy = false
    @State private var error: String?
    @State private var device: CodexDeviceStart?
    @State private var showImport = false
    @State private var importJson = ""
    @State private var polling: Task<Void, Never>?

    private static let deadline: TimeInterval = 15 * 60
    private static let minimumIntervalMs: Double = 1000

    var body: some View {
        EditorSheet(title: "Connect ChatGPT", confirm: "", ready: false, error: error, onConfirm: {}) {
            VStack(alignment: .leading, spacing: 6) {
                BodyText("ChatGPT subscription (Codex)", medium: true)
                Hint("Use a ChatGPT Plus/Pro plan's Codex allowance instead of API credits. Sign in with the account — usage bills against the subscription's limits.")
            }
            if let device {
                Hint("Open the page below in a browser where you're signed in to ChatGPT, and enter this code:")
                Text(device.userCode ?? "")
                    .font(AppFont.mono(28))
                    .kerning(2)
                    .foregroundStyle(Palette.foreground)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity)
                AppButton("Open \(device.verificationUrl)", variant: .outline, fullWidth: true) {
                    if let url = URL(string: device.verificationUrl) { openURL(url) }
                }
                Mono("Waiting for you to approve…", size: 11.5)
                AppButton("Cancel", variant: .ghost) { stop() }
            } else {
                AppButton(busy ? "Starting…" : "Sign in with ChatGPT", busy: busy, fullWidth: true) { Task { await start() } }
                AppButton(showImport ? "Hide import" : "Import from Codex CLI instead", variant: .ghost, disabled: busy) {
                    showImport.toggle()
                }
                if showImport {
                    Hint("If the device sign-in is unavailable, run `codex login` on your own machine and paste the contents of `~/.codex/auth.json` here. The tokens are stored encrypted and never shown again.")
                    CodeBox(text: $importJson, placeholder: "{ \"tokens\": { … } }", editable: !busy)
                    AppButton(busy ? "Importing…" : "Import", busy: busy, disabled: importJson.jsTrim.isEmpty) {
                        Task { await importLogin() }
                    }
                }
            }
        }
        .onDisappear { polling?.cancel() }
    }

    private func stop() {
        polling?.cancel()
        polling = nil
        device = nil
    }

    private func start() async {
        guard let seam = model.seam, !busy else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            let started = try await seam.codexStart()
            guard let authId = started.deviceAuthId, let code = started.userCode else {
                error = "\(started.error ?? "Device sign-in is unavailable.") You can still import a Codex CLI login below."
                showImport = true
                return
            }
            device = started
            let every = max(CodexConnect.minimumIntervalMs, SettingsLogic.timeSpanMs(started.interval))
            polling = Task { await poll(seam, authId: authId, code: code, everyMs: every) }
        } catch {
            Haptics.error()
            self.error = problemText(error)
        }
    }

    /// Ask until the sign-in is approved, refused, or the code has expired. A
    /// call that fails is just a missed beat.
    private func poll(_ seam: Seam, authId: String, code: String, everyMs: Double) async {
        let started = Date()
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(Int(everyMs)))
            if Task.isCancelled { return }
            if Date().timeIntervalSince(started) > CodexConnect.deadline {
                finish("The sign-in code expired. Start again when you're ready.")
                return
            }
            guard let result = try? await seam.codexPoll(deviceAuthId: authId, userCode: code) else { continue }
            if Task.isCancelled { return }
            if result.status == .pending { continue }
            finish(result.status == .connected ? nil : result.error ?? "The sign-in failed.")
            return
        }
    }

    private func finish(_ why: String?) {
        device = nil
        polling = nil
        if let why {
            Haptics.error()
            error = why
        } else {
            Haptics.success()
            dismiss()
        }
    }

    private func importLogin() async {
        guard let seam = model.seam, !busy else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            if let why = try await seam.codexImport(json: importJson) {
                Haptics.error()
                error = why
                return
            }
            importJson = ""
            Haptics.success()
            dismiss()
        } catch {
            Haptics.error()
            self.error = problemText(error)
        }
    }
}
#endif
