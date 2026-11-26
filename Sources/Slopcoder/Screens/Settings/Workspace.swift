#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

// The pages about where sessions run and what they can reach: MCP servers,
// remote nodes, the terminal, and the git author.

// MARK: - MCP servers

struct McpServersPage: View {
    @Environment(AppModel.self) private var model
    @State private var servers: [McpServerSummary]?
    @State private var error: String?
    @State private var busy = false
    @State private var confirmation: Confirmation?
    @State private var editing: McpDraft?

    var body: some View {
        SettingsScroll(error: error, loading: servers == nil && error == nil, onRefresh: load) {
            Hint("Every enabled server attaches to each of your sessions. Stdio servers run inside the session's sandbox; HTTP servers are called directly. Tools appear to the agent as mcp__<server>__<tool>.")
            SettingsSection(label: "servers", count: servers?.count) {
                if servers?.isEmpty == true { Hint("No MCP servers configured yet.").padding(.vertical, 8) }
                ForEach(servers ?? []) { server in
                    ListRow(
                        title: server.displayName,
                        subtitle: SettingsLogic.mcpTarget(server),
                        tag: server.kind == .stdio ? "stdio" : "http",
                        switchValue: server.enabled,
                        onSwitch: { on in Task { await run { _ = try await $0.setMcpServerEnabled(server.id, enabled: on) } } },
                        disabled: busy,
                        dimmed: !server.enabled,
                        menu: [
                            RowAction(title: "Edit", symbol: "pencil") { editing = McpDraft(server: server) },
                            RowAction(title: "Remove", symbol: "trash", destructive: true) { remove(server) },
                        ],
                        onTap: { editing = McpDraft(server: server) }
                    )
                }
            }
        }
        .navigationTitle("MCP servers")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                BarButton("Add server", systemImage: "plus") { editing = McpDraft(server: nil) }
            }
        }
        .confirms($confirmation)
        .task { await load() }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { McpServerEditor(server: $0.server) }
    }

    private func remove(_ server: McpServerSummary) {
        confirmation = Confirmation(
            title: "Remove this MCP server?",
            message: "“\(server.displayName)” detaches from new sessions and its stored secrets are forgotten.",
            action: "Remove"
        ) {
            Task { await run { _ = try await $0.deleteMcpServer(server.id) } }
        }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            servers = try await seam.mcpServers()
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    private func run(_ command: (Seam) async throws -> Void) async {
        guard let seam = model.seam, !busy else { return }
        busy = true
        do { try await command(seam) } catch { self.error = problemText(error) }
        await load()
        busy = false
    }
}

private struct McpDraft: Identifiable {
    let id = UUID()
    let server: McpServerSummary?
}

private struct McpServerEditor: View {
    let server: McpServerSummary?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var kind: McpTransportKind
    @State private var command: String
    @State private var args: String
    @State private var url: String
    @State private var secrets = ""
    @State private var clearSecrets = false
    @State private var saving = false
    @State private var error: String?
    private let original: [String]

    init(server: McpServerSummary?) {
        self.server = server
        let fields = [server?.displayName ?? "", server?.command ?? "", server?.args.joined(separator: "\n") ?? "", server?.url ?? ""]
        original = fields
        _name = State(initialValue: fields[0])
        _kind = State(initialValue: server?.kind ?? .stdio)
        _command = State(initialValue: fields[1])
        _args = State(initialValue: fields[2])
        _url = State(initialValue: fields[3])
    }

    private var dirty: Bool {
        [name, command, args, url] != original || kind != (server?.kind ?? .stdio) || !secrets.isEmpty || clearSecrets
    }

    var body: some View {
        let stdio = kind == .stdio
        EditorSheet(
            title: server.map { "Edit \"\($0.displayName)\"" } ?? "Add an MCP server",
            confirm: server == nil ? "Add server" : "Save changes",
            ready: !name.jsTrim.isEmpty && !saving, dirty: dirty, error: error,
            onConfirm: { Task { await save() } }
        ) {
            FormField(label: "name", text: $name, placeholder: "github", editable: !saving)
            SheetSegments(
                label: "transport",
                options: [SheetOption(key: "stdio", label: "stdio · in the sandbox"), SheetOption(key: "http", label: "HTTP · remote")],
                selected: stdio ? "stdio" : "http",
                onSelect: { kind = $0 == "stdio" ? .stdio : .http }
            )
            if stdio {
                FormField(label: "command", text: $command, placeholder: "npx", editable: !saving)
                CodeBox(
                    label: "arguments (one per line)", text: $args,
                    placeholder: "-y\n@modelcontextprotocol/server-filesystem\n/workspace", minHeight: 90, editable: !saving
                )
            } else {
                FormField(label: "url", text: $url, placeholder: "https://mcp.example.com/sse", keyboard: .URL, editable: !saving)
            }
            CodeBox(
                label: stdio ? "environment variables (KEY=value per line)" : "headers (Name=value per line)",
                text: $secrets, placeholder: "API_TOKEN=…", minHeight: 90, editable: !saving
            )
            if server?.hasSecrets == true {
                Hint("Stored values are never shown. Leave empty to keep them, or enter new ones to replace them.")
                SwitchRow(label: "Clear stored values", isOn: $clearSecrets, disabled: saving)
            }
        }
    }

    private func save() async {
        guard let seam = model.seam, !saving else { return }
        let parsed = SettingsLogic.parseSecrets(secrets)
        if let refused = parsed.error {
            Haptics.error()
            error = refused
            return
        }
        saving = true
        defer { saving = false }
        error = nil
        do {
            // On an edit, nil keeps what is stored; an empty set clears it.
            let kept: [String: String]? = server == nil || clearSecrets || !parsed.secrets.isEmpty ? parsed.secrets : nil
            let trimmedUrl = url.jsTrim
            let request = McpServerRequest(
                displayName: name.jsTrim, kind: kind, command: command.jsTrim, args: SettingsLogic.splitLines(args),
                url: kind == .http && !trimmedUrl.isEmpty ? trimmedUrl : nil, secrets: kept
            )
            let refused: String?
            if let server {
                refused = try await seam.updateMcpServer(server.id, request)
            } else {
                refused = try await seam.createMcpServer(request).error
            }
            if let refused {
                Haptics.error()
                error = refused
                return
            }
            Haptics.confirm()
            dismiss()
        } catch {
            Haptics.error()
            self.error = error is SeamError ? "The server could not be reached. Nothing was saved." : problemText(error)
        }
    }
}

// MARK: - remote nodes

/// A public key to install on a node, and the node it is for.
private struct KeyInstall: Identifiable {
    let id = UUID()
    let node: String
    let line: String
}

private struct NodeDraft: Identifiable {
    let id = UUID()
    let node: RemoteNodeSummary?
}

struct RemoteNodesPage: View {
    @Environment(AppModel.self) private var model
    @State private var nodes: [RemoteNodeSummary]?
    @State private var error: String?
    @State private var busy = false
    @State private var confirmation: Confirmation?
    @State private var notice: Notice?
    @State private var install: KeyInstall?
    @State private var editing: NodeDraft?
    /// A key minted by the editor, shown once the editor has closed.
    @State private var handed: KeyInstall?

    var body: some View {
        SettingsScroll(error: error, loading: nodes == nil && error == nil, onRefresh: load) {
            Hint("Real machines you own, reached over SSH from the server — the private key never leaves it. Attach a node to a session and the agent gets a run_on_node tool; every command it runs there asks for your approval first. Unlike a sandbox there is no undo.")
            SettingsSection(label: "nodes", count: nodes?.count) {
                if nodes?.isEmpty == true { Hint("No remote nodes registered yet.").padding(.vertical, 8) }
                ForEach(nodes ?? []) { node in
                    ListRow(
                        title: node.name,
                        subtitle: SettingsLogic.nodeTarget(node),
                        tag: node.keyKind == .generated ? "generated" : "pasted",
                        warn: node.lastError,
                        switchValue: node.enabled,
                        onSwitch: { on in Task { await run { _ = try await $0.setNodeEnabled(node.id, enabled: on) } } },
                        disabled: busy,
                        dimmed: !node.enabled,
                        menu: menu(for: node),
                        onTap: { editing = NodeDraft(node: node) }
                    ) {
                        Mono("\(node.hostKeyFingerprint ?? "unpinned") · seen \(node.lastConnectedAt.map { SettingsLogic.stamp($0) } ?? "never")")
                            .lineLimit(1)
                    }
                }
            }
        }
        .navigationTitle("Remote nodes")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                BarButton("Register a node", systemImage: "plus") { editing = NodeDraft(node: nil) }
            }
        }
        .confirms($confirmation)
        .tells($notice)
        .task { await load() }
        .sheet(item: $editing, onDismiss: {
            install = handed
            handed = nil
            Task { await load() }
        }) { draft in
            NodeEditor(node: draft.node) { name, line in handed = KeyInstall(node: name, line: line) }
        }
        .sheet(item: $install) { item in
            AppSheet(title: "Install this key") {
                Hint("Install this key on \(item.node) — run as the login user on the node:")
                CopyBox(value: SettingsLogic.installCommand(item.line))
                ShareLink(item: SettingsLogic.installCommand(item.line)) {
                    Text("Share").font(AppFont.sansMedium(14)).foregroundStyle(Palette.primary)
                }
                Hint("The public key stays re-viewable here; the private key never leaves the server.")
            }
        }
    }

    private func menu(for node: RemoteNodeSummary) -> [RowAction] {
        var actions = [RowAction(title: "Test", symbol: "bolt") { Task { await test(node) } }]
        if node.keyKind == .generated, !node.publicKey.isEmpty {
            actions.append(RowAction(title: "Show key", symbol: "key") { install = KeyInstall(node: node.name, line: node.publicKey) })
        }
        if node.hostKeyFingerprint != nil {
            actions.append(RowAction(title: "Reset pin", symbol: "pin.slash") {
                confirmation = Confirmation(
                    title: "Reset the host key pin?",
                    message: "Only do this if “\(node.name)” was legitimately reinstalled. The next successful connection pins whatever key the machine presents.",
                    action: "Reset pin"
                ) {
                    Task { await run { _ = try await $0.resetNodeHostKeyPin(node.id) } }
                }
            })
        }
        actions.append(RowAction(title: "New key", symbol: "arrow.triangle.2.circlepath") {
            confirmation = Confirmation(
                title: "Generate a new key?",
                message: "The current key for “\(node.name)” stops working once you replace the authorized_keys line on the node.",
                action: "Generate"
            ) {
                Task { await regenerate(node) }
            }
        })
        actions.append(RowAction(title: "Edit", symbol: "pencil") { editing = NodeDraft(node: node) })
        actions.append(RowAction(title: "Remove", symbol: "trash", destructive: true) {
            confirmation = Confirmation(
                title: "Remove this node?",
                message: "“\(node.name)” detaches from sessions and its key is forgotten. The audit log of past commands is kept.",
                action: "Remove"
            ) {
                Task { await run { _ = try await $0.deleteNode(node.id) } }
            }
        })
        return actions
    }

    private func test(_ node: RemoteNodeSummary) async {
        await run { seam in
            let result = try await seam.testNode(node.id)
            if result.ok { Haptics.confirm() } else { Haptics.error() }
            notice = Notice(title: result.ok ? "Connected" : "Could not connect", message: result.detail)
        }
    }

    private func regenerate(_ node: RemoteNodeSummary) async {
        await run { seam in
            let result = try await seam.regenerateNodeKey(node.id)
            if let line = result.authorizedKeysLine, result.error == nil {
                install = KeyInstall(node: node.name, line: line)
            } else {
                notice = Notice(title: "Could not generate a key", message: result.error ?? "The server did not answer.")
            }
        }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            nodes = try await seam.nodes()
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    private func run(_ command: (Seam) async throws -> Void) async {
        guard let seam = model.seam, !busy else { return }
        busy = true
        do { try await command(seam) } catch { self.error = problemText(error) }
        await load()
        busy = false
    }
}

private struct NodeEditor: View {
    let node: RemoteNodeSummary?
    /// Called with the node's name and its authorized_keys line when a key was generated.
    let onKey: (String, String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var host: String
    @State private var port: String
    @State private var username: String
    @State private var generate = true
    @State private var privateKey = ""
    @State private var saving = false
    @State private var error: String?
    private let original: [String]

    init(node: RemoteNodeSummary?, onKey: @escaping (String, String) -> Void) {
        self.node = node
        self.onKey = onKey
        let fields = [node?.name ?? "", node?.host ?? "", String(node?.port ?? 22), node?.username ?? ""]
        original = fields
        _name = State(initialValue: fields[0])
        _host = State(initialValue: fields[1])
        _port = State(initialValue: fields[2])
        _username = State(initialValue: fields[3])
    }

    private var creating: Bool { node == nil }

    var body: some View {
        EditorSheet(
            title: node.map { "Edit \"\($0.name)\"" } ?? "Register a node",
            confirm: creating ? "Register node" : "Save changes",
            ready: !name.jsTrim.isEmpty && !host.jsTrim.isEmpty && !username.jsTrim.isEmpty && !saving,
            dirty: [name, host, port, username] != original || !privateKey.isEmpty, error: error,
            onConfirm: { Task { await save() } }
        ) {
            FormField(label: "name", text: $name, placeholder: "pi-media", hint: "The handle the agent uses — short, no spaces.", editable: !saving)
            HStack(alignment: .top, spacing: 12) {
                FormField(label: "host", text: $host, placeholder: "192.168.1.20", keyboard: .URL, editable: !saving)
                FormField(label: "port", text: $port, placeholder: "22", keyboard: .numbersAndPunctuation, editable: !saving)
                    .frame(width: 88)
            }
            FormField(label: "username", text: $username, placeholder: "pi", editable: !saving)
            if creating {
                SheetSegments(
                    label: "ssh key",
                    options: [SheetOption(key: "generate", label: "Generate (recommended)"), SheetOption(key: "paste", label: "Paste a private key")],
                    selected: generate ? "generate" : "paste",
                    onSelect: { generate = $0 == "generate" }
                )
            }
            if !creating || !generate {
                CodeBox(
                    label: creating ? "private key" : "replace private key", text: $privateKey,
                    placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----",
                    hint: "Unencrypted OpenSSH, PKCS#8, or PuTTY format.\(creating ? "" : " Leave empty to keep the stored key.")",
                    minHeight: 140, editable: !saving
                )
            }
        }
    }

    private func save() async {
        guard let seam = model.seam, !saving else { return }
        let pasted = privateKey.jsTrim.isEmpty ? nil : privateKey
        if creating, !generate, pasted == nil {
            Haptics.error()
            error = "Paste the private key, or switch to a generated one."
            return
        }
        saving = true
        defer { saving = false }
        error = nil
        do {
            let request = RemoteNodeRequest(
                name: name.jsTrim, host: host.jsTrim, port: SettingsLogic.parseInt(port.jsTrim) ?? 22,
                username: username.jsTrim, privateKeyPem: creating && generate ? nil : pasted
            )
            if let node {
                if let refused = try await seam.updateNode(node.id, request) {
                    Haptics.error()
                    error = refused
                    return
                }
            } else {
                let created = try await seam.createNode(request)
                if let refused = created.error {
                    Haptics.error()
                    error = refused
                    return
                }
                if let line = created.authorizedKeysLine { onKey(request.name, line) }
            }
            Haptics.confirm()
            dismiss()
        } catch {
            Haptics.error()
            self.error = error is SeamError ? "The server could not be reached. Nothing was saved." : problemText(error)
        }
    }
}

// MARK: - terminal

struct TerminalPrefsPage: View {
    @Environment(AppModel.self) private var model
    @State private var shell = ""
    @State private var packages = ""
    @State private var defaults = TerminalDefaults(packages: "", shell: "")
    @State private var stored: [String]?
    @State private var busy = false
    @State private var saved = false
    @State private var error: String?

    private var dirty: Bool { stored.map { $0 != [shell, packages] } ?? false }

    var body: some View {
        SettingsScroll(error: error, loading: stored == nil && error == nil) {
            Hint("Personalize the in-session terminal. The first time a container's terminal opens, slopcoder installs these tools and launches your shell. Leave a field blank to use the instance default. Changes apply the next time a fresh terminal starts (after the sandbox respawns).")
            FormField(
                label: "preferred shell", text: $shell, placeholder: defaults.shell,
                hint: "e.g. fish, zsh, bash. Falls back to bash when the shell isn't in the image. Default: \(defaults.shell.isEmpty ? "—" : defaults.shell)."
            )
            FormField(
                label: "dev tools", text: $packages, placeholder: defaults.packages,
                hint: "Space-separated apt packages, installed best-effort on first open. Default: \(defaults.packages.isEmpty ? "—" : defaults.packages)."
            )
            if saved, !dirty { Note(text: "saved — applies to the next fresh terminal", ok: true) }
            Hint("A repo can also ship a .slopcoder/terminal-init.sh hook that runs after the tools install — for project-specific setup.")
        }
        .navigationTitle("Terminal")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                ConfirmBarButton("Save") { Task { await save() } }.disabled(!dirty || busy)
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            async let instance = seam.terminalDefaults()
            let prefs = try await seam.terminalPrefs()
            if let instance = try await instance { defaults = instance }
            shell = prefs.shell ?? ""
            packages = prefs.packages ?? ""
            stored = [shell, packages]
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    private func save() async {
        guard let seam = model.seam, !busy else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await seam.saveTerminalPrefs(packages: packages, shell: shell)
            Haptics.confirm()
            stored = [shell, packages]
            saved = true
        } catch {
            Haptics.error()
            self.error = problemText(error)
        }
    }
}

// MARK: - git identity

struct GitIdentityPage: View {
    @Environment(AppModel.self) private var model
    @State private var name = ""
    @State private var email = ""
    @State private var stored: [String]?
    @State private var busy = false
    @State private var saved = false
    @State private var error: String?

    private var dirty: Bool { stored.map { $0 != [name, email] } ?? false }

    var body: some View {
        SettingsScroll(error: error, loading: stored == nil && error == nil) {
            Hint("The author your sessions commit as by default. slopcoder writes it into each workspace repo's user.name and user.email when the sandbox is provisioned. A value set in a repo by hand (git config user.email …) is never replaced. Changes reach existing sessions at their next turn.")
            FormField(label: "name", text: $name, placeholder: "Ada Lovelace", capitalization: .words, editable: !busy)
            FormField(
                label: "email", text: $email, placeholder: "ada@example.com",
                hint: "Use the address your git host links to your account (or its no-reply address) so commits are attributed to you. Leave both blank to set nothing.",
                mono: true, keyboard: .emailAddress, editable: !busy
            )
            if saved, !dirty { Note(text: "saved — applies from each session's next turn", ok: true) }
        }
        .navigationTitle("Git identity")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                ConfirmBarButton("Save") { Task { await save() } }.disabled(!dirty || busy)
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            let prefs = try await seam.gitIdentity()
            name = prefs.name ?? ""
            email = prefs.email ?? ""
            stored = [name, email]
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    private func save() async {
        guard let seam = model.seam, !busy else { return }
        if let refused = SettingsLogic.gitIdentityProblems(name: name, email: email) {
            Haptics.error()
            error = refused
            return
        }
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await seam.saveGitIdentity(name: name, email: email)
            Haptics.confirm()
            stored = [name, email]
            saved = true
        } catch {
            Haptics.error()
            self.error = problemText(error)
        }
    }
}
#endif
