#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// The settings hub: who is signed in and to what, then a page for each part of
/// the workspace, then the way out.
struct SettingsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var counts: [SettingsPage: String] = [:]
    @State private var serverVersion: String?
    @State private var confirmation: Confirmation?

    private static let pages: [(page: SettingsPage, label: String)] = [
        (.connections, "Connections"), (.mcp, "MCP servers"), (.nodes, "Remote nodes"), (.terminal, "Terminal"),
        (.gitIdentity, "Git identity"), (.facets, "Facets"), (.hooks, "Hooks"), (.memory, "Memory"),
        (.skills, "Skills"), (.channels, "Channels"), (.apiKeys, "API keys"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 0) {
                    SectionLabel("account")
                    FactRow(label: "signed in as", value: model.auth.credential?.userName ?? "—")
                    FactRow(label: "server", value: model.auth.credential?.server ?? "—", mono: true)
                    FactRow(label: "server version", value: serverVersion ?? "—", mono: true)
                    FactRow(label: "this device", value: "iPhone (slopcoder)")
                }
                VStack(alignment: .leading, spacing: 0) {
                    SectionLabel("workspace")
                    ForEach(SettingsScreen.pages, id: \.page) { entry in
                        HubRow(label: entry.label, count: counts[entry.page]) {
                            model.router.select(.settings(entry.page))
                        }
                        .openBeside(model.router.selection(on: .settings) == .settings(entry.page))
                    }
                }
                VStack(alignment: .leading, spacing: 0) {
                    SectionLabel("session")
                    AppButton("Sign out", variant: .linkDestructive) {
                        confirmation = Confirmation(
                            title: "Sign out?",
                            message: "This device’s key is dropped. It stays listed under API keys on the server until you revoke it there.",
                            action: "Sign out"
                        ) {
                            Task { await model.auth.signOut() }
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Brand(height: 13)
                    Meta("version \(AppInfo.label)")
                }
                .opacity(0.7)
                .padding(.top, 24)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .pageBackground()
        .navigationTitle("Settings")
        .confirms($confirmation)
        .task { await load() }
        .onAppear { Task { await load() } }
        // The counts beside each row change on the pages they lead to.
        .onChange(of: model.router.settings) { _, _ in Task { await load() } }
    }

    /// Each count is read on its own: one that fails leaves its row bare rather
    /// than taking the page down.
    private func load() async {
        guard let seam = model.seam else { return }
        async let version = try? seam.serverProtocol()?.version
        async let connections = try? seam.connections()
        async let git = try? seam.gitConnections()
        async let nodes = try? seam.nodes()
        async let facets = try? seam.facets()
        async let skills = try? seam.skills()
        async let channels = try? seam.channels()

        serverVersion = await version
        if let models = await connections {
            let accounts = await git ?? []
            counts[.connections] = accounts.isEmpty ? String(models.count) : "\(models.count) · \(accounts.count) git"
        }
        if let nodes = await nodes { counts[.nodes] = String(nodes.count) }
        if let facets = await facets { counts[.facets] = String(facets.count) }
        if let skills = await skills { counts[.skills] = String(skills.count) }
        if let channels = await channels { counts[.channels] = String(channels.count) }
    }
}

private struct FactRow: View {
    let label: String
    let value: String
    var mono = false

    var body: some View {
        HStack(spacing: 12) {
            Meta(label)
            Spacer(minLength: 8)
            if mono { Mono(value).lineLimit(1) } else { BodyText(value).lineLimit(1) }
        }
        .frame(minHeight: 40)
        .topBorder()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(value)")
    }
}

/// The page a hub row leads to.
struct SettingsPageView: View {
    let page: SettingsPage

    var body: some View {
        switch page {
        case .connections: ConnectionsPage()
        case .mcp: McpServersPage()
        case .nodes: RemoteNodesPage()
        case .terminal: TerminalPrefsPage()
        case .gitIdentity: GitIdentityPage()
        case .facets: FacetsPage()
        case .hooks: HooksPage()
        case .memory: MemoryPage()
        case .skills: SkillsPage()
        case .channels: ChannelsPage()
        case .apiKeys: ApiKeysPage()
        }
    }
}
#endif
