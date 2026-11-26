#if canImport(UIKit)
import SlopcoderCore
import SwiftUI
import WebKit

/// What the agent published: reports, logs, dashboards, mini apps, photos.
struct ArtifactsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    @State private var artifacts: [ArtifactSummary]?
    @State private var error: String?
    @State private var deleting: ArtifactSummary?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ConnectionBanner(onRetry: { Task { await load() } })
                if let error { ErrorText(error) }
                if artifacts == nil, error == nil { Skeleton(rows: 4) }
                if let artifacts, artifacts.isEmpty {
                    EmptyState("Nothing published yet.", detail: "Ask the agent for a report, dashboard or mini app and publish it.")
                }
                ForEach(artifacts ?? []) { artifact in
                    ArtifactListCard(artifact: artifact, onOpen: { open(artifact) }, onDelete: { deleting = artifact })
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .pageBackground()
        .navigationTitle("Artifacts")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(
            deleting.map { "Delete ‘\($0.title)’?" } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let target = deleting { Task { await remove(target) } }
                deleting = nil
            }
            Button("Cancel", role: .cancel) { deleting = nil }
        } message: {
            Text("The artifact and its share link, if it has one, are gone for good.")
        }
    }

    private func open(_ artifact: ArtifactSummary) {
        router.push(.artifact(id: artifact.id, version: nil))
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            artifacts = try await seam.artifacts()
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = describe(error)
        }
    }

    private func remove(_ artifact: ArtifactSummary) async {
        guard let seam = model.seam else { return }
        do {
            _ = try await seam.deleteArtifact(artifact.id)
            Haptics.confirm()
        } catch {
            Haptics.error()
        }
        await load()
    }
}

private struct ArtifactListCard: View {
    let artifact: ArtifactSummary
    let onOpen: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(artifact.title).font(AppFont.sansMedium(15)).foregroundStyle(Palette.foreground).lineLimit(2)
                        if artifact.shared { Chip("shared", color: Palette.primary, filled: true) }
                    }
                    Meta("\(artifact.format.rawValue) · \(ArtifactPresentation.meta(artifact))")
                    if !artifact.description.isEmpty {
                        Text(artifact.description).font(AppFont.sans(13)).foregroundStyle(Palette.mutedForeground).lineLimit(2)
                    }
                    if !artifact.preview.isEmpty {
                        Text(artifact.preview)
                            .font(AppFont.mono(11))
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(3)
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.muted.opacity(0.35), in: RoundedRectangle(cornerRadius: Radius.sm))
                    }
                    let source = artifact.sessionTitle.map { "from \($0)" } ?? artifact.routineName.map { "from the \($0) routine" }
                    if let source { Mono(source, size: 11).lineLimit(1) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Menu {
                Button(action: onOpen) { Label("Open", systemImage: "doc.text") }
                Button(role: .destructive, action: onDelete) { Label("Delete", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 15)).foregroundStyle(Palette.mutedForeground).frame(width: 32, height: 32)
            }
            .accessibilityLabel("More")
        }
        .padding(12)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border, lineWidth: 1))
    }
}

/// One artifact, owning the whole screen: a document to read, a photo to zoom, a
/// sound to play, or a self-contained page to use.
struct ArtifactScreen: View {
    let artifactId: String
    let version: Int?

    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    @State private var loaded: ArtifactPresentation.Loaded?
    @State private var answered = false
    @State private var error: String?
    @State private var busy = false
    @State private var showingDetails = false
    @State private var confirmingDelete = false
    @State private var sharing: ShareItem?

    private struct ShareItem: Identifiable {
        let id = UUID()
        let url: URL
    }

    private var artifact: ArtifactSummary? { loaded?.artifact }

    private var shareLink: String? {
        guard let path = artifact?.sharePath, !path.isEmpty, let seam = model.seam else { return nil }
        return seam.shareUrl(path)
    }

    var body: some View {
        Group {
            if let loaded, let seam = model.seam {
                VStack(spacing: 0) {
                    ArtifactBody(loaded: loaded, seam: seam)
                        // A different edition is a different body: nothing of the
                        // last one's scroll position or web view should carry over.
                        .id("\(loaded.artifact.id):\(loaded.artifact.version):\(loaded.pinned.map(String.init) ?? "latest")")
                    if loaded.pinned != nil || loaded.missingVersion != nil { editionBar(loaded) }
                    if let error { ErrorText(error).padding(12) }
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if let error { ErrorText(error) }
                        if !answered, error == nil { Skeleton(rows: 4) }
                        if answered, loaded == nil, error == nil { ErrorText("This artifact no longer exists, or is not yours.") }
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .refreshable { await load() }
            }
        }
        .pageBackground()
        .navigationTitle(artifact?.title ?? "Artifact")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if artifact != nil {
                ToolbarItem(placement: .topBarTrailing) { menu }
            }
        }
        .task { await load() }
        .sheet(item: $sharing) { item in ActivityView(items: [item.url]) }
        .alert(artifact?.title ?? "", isPresented: $showingDetails) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(details)
        }
        .confirmationDialog(
            "Delete ‘\(artifact?.title ?? "")’?", isPresented: $confirmingDelete, titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { Task { await remove() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The artifact and its share link, if it has one, are gone for good.")
        }
    }

    private var menu: some View {
        Menu {
            // The share link opens in any browser, so it is the one to hand out;
            // the owner's own URL wants the device's key and is no use to anyone else.
            Button { Task { await share() } } label: { Label("Share…", systemImage: "square.and.arrow.up") }
            if let shareLink {
                Button { copyText(shareLink) } label: { Label("Copy link", systemImage: "doc.on.doc") }
                Button {
                    if let url = URL(string: shareLink) { UIApplication.shared.open(url) }
                } label: { Label("Open in browser", systemImage: "safari") }
                Button { Task { await setShared(false) } } label: { Label("Stop sharing", systemImage: "lock") }
            }
            Button { showingDetails = true } label: { Label("Details", systemImage: "info.circle") }
            Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete", systemImage: "trash") }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .disabled(busy)
        .accessibilityLabel("More")
    }

    private var details: String {
        guard let artifact else { return "" }
        return [
            artifact.description,
            "\(artifact.format.rawValue) · \(artifact.slug) · \(ArtifactPresentation.meta(artifact))",
            artifact.sessionTitle.map { "from \($0)" } ?? "",
            artifact.routineName.map { "from the \($0) routine" } ?? "",
        ].filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    private func editionBar(_ loaded: ArtifactPresentation.Loaded) -> some View {
        HStack(spacing: 10) {
            Mono(loaded.pinned.map { "Version \($0), an earlier edition." }
                ?? "Version \(loaded.missingVersion ?? 0) is no longer kept; this is the latest (v\(loaded.artifact.version)).")
                .frame(maxWidth: .infinity, alignment: .leading)
            if loaded.pinned != nil {
                AppButton("Latest") {
                    router.pop()
                    router.show(.artifact(id: artifactId, version: nil))
                }
            }
        }
        .padding(12)
        .background(Palette.card)
        .topBorder()
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            loaded = try await ArtifactPresentation.load(seam, id: artifactId, version: version)
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = describe(error)
        }
        answered = true
    }

    private func setShared(_ on: Bool, thenPresent: Bool = false) async {
        guard let seam = model.seam, let artifact, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            guard let updated = try await seam.shareArtifact(artifact.id, shared: on) else {
                Haptics.error()
                return
            }
            loaded?.artifact.shareToken = updated.shareToken
            loaded?.artifact.shared = updated.shared
            loaded?.artifact.sharePath = updated.sharePath
            Haptics.confirm()
            if thenPresent, let path = updated.sharePath, let url = URL(string: seam.shareUrl(path)) { sharing = ShareItem(url: url) }
        } catch {
            Haptics.error()
        }
    }

    private func share() async {
        if let shareLink, let url = URL(string: shareLink) {
            sharing = ShareItem(url: url)
        } else {
            // No link yet: mint one, then hand it to the share sheet.
            await setShared(true, thenPresent: true)
        }
    }

    private func remove() async {
        guard let seam = model.seam else { return }
        do {
            _ = try await seam.deleteArtifact(artifactId)
            Haptics.confirm()
            router.pop()
        } catch {
            Haptics.error()
        }
    }
}

private struct ArtifactBody: View {
    let loaded: ArtifactPresentation.Loaded
    let seam: Seam

    private var artifact: ArtifactSummary { loaded.artifact }

    private var rawUrl: String {
        loaded.pinned.map { seam.artifactVersionRawUrl(artifact.id, version: $0) } ?? seam.artifactRawUrl(artifact.id)
    }

    private var viewUrl: String {
        loaded.pinned.map { seam.artifactVersionViewUrl(artifact.id, version: $0) } ?? seam.artifactViewUrl(artifact.id)
    }

    var body: some View {
        if artifact.format == .html {
            if artifact.hasApp == true {
                HostedApp(artifact: artifact, seam: seam)
            } else {
                HtmlArtifact(url: viewUrl, headers: seam.authHeaders, title: artifact.title)
            }
        } else if Media.isImage(artifact.contentType) {
            ArtifactPhoto(source: MediaSource(uri: rawUrl, authed: true), headers: seam.authHeaders, title: artifact.title)
        } else if Media.isAudio(artifact.contentType) {
            VStack {
                Spacer()
                InlineAudio(url: rawUrl, headers: seam.authHeaders, title: artifact.title).padding(24)
                Spacer()
            }
        } else if let text = loaded.text {
            ScrollView {
                Group {
                    if artifact.format == .markdown {
                        Prose(text, size: .document)
                    } else {
                        // Not markdown: shown exactly as it is, and never wrapped —
                        // a wrapped log line is a different log line.
                        ScrollView(.horizontal, showsIndicators: false) {
                            Text(text).font(AppFont.mono(12.5)).foregroundStyle(Palette.foreground).lineSpacing(5).textSelection(.enabled)
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            EmptyState(
                "This one is a \(artifact.contentType) file of \(ArtifactPresentation.bytes(artifact.size)).",
                detail: "Share it to open it elsewhere."
            )
            .frame(maxHeight: .infinity)
        }
    }
}

private struct ArtifactPhoto: View {
    let source: MediaSource
    let headers: [String: String]
    let title: String
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                ZoomableImage(image: image).ignoresSafeArea(edges: .bottom).accessibilityLabel("Photo artifact: \(title)")
            } else if failed {
                EmptyState("This image could not be loaded.").frame(maxHeight: .infinity)
            } else {
                ProgressView().tint(Palette.primary).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.black)
        .task {
            do {
                image = try await ImageLoader.shared.image(source, headers: headers)
            } catch {
                failed = true
            }
        }
    }
}

/// A mini app: an artifact whose page is served by a container that has to be
/// started. Opening it starts it; idle ones stop on their own.
private struct HostedApp: View {
    let artifact: ArtifactSummary
    let seam: Seam
    @State private var app: ArtifactAppStatus?
    @State private var busy = false

    private var up: Bool { app?.state == "running" || app?.state == "starting" }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                AppButton(busy ? "Working…" : up ? "Stop" : "Play", disabled: busy) { Task { await toggle() } }
            }
            .padding(8)

            if up, let app {
                HtmlArtifact(url: "\(seam.baseUrl)\(app.previewUrl)\(app.landingPath)", headers: seam.authHeaders, title: artifact.title)
            } else {
                EmptyState(app?.error ?? "Opening this artifact starts its app container. Idle apps stop automatically.")
                    .frame(maxHeight: .infinity)
            }
        }
        .task {
            do {
                app = try await seam.artifactApp(artifact.id, running: true)
                if app?.state == "starting" {
                    try await Task.sleep(nanoseconds: 2_500_000_000)
                    app = try? await seam.artifactApp(artifact.id)
                }
            } catch is CancellationError {
                return
            } catch {
                Haptics.error()
            }
        }
    }

    private func toggle() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            app = try await seam.artifactApp(artifact.id, running: !up)
            Haptics.confirm()
        } catch {
            Haptics.error()
        }
    }
}

/// A self-contained page the agent published, in a web view of its own.
///
/// The server serves it under an opaque-origin sandbox, and this view adds its
/// half: no cookies or storage that outlive it, no file access, no app bridge,
/// and nowhere to go. The device's key rides the one request that fetches the
/// page and nothing after it — a page that navigates is refused, and a link
/// somebody taps opens in the system browser instead.
private struct HtmlArtifact: View {
    let url: String
    let headers: [String: String]
    let title: String
    @State private var failed = false
    @State private var attempt = 0

    var body: some View {
        if failed {
            VStack(spacing: 14) {
                ErrorText("This page could not be opened.")
                AppButton("Try again") {
                    failed = false
                    attempt += 1
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ArtifactWebView(url: url, headers: headers, onFailure: { failed = true })
                .id(attempt)
                .accessibilityLabel("Interactive artifact: \(title)")
        }
    }
}

private struct ArtifactWebView: UIViewRepresentable {
    let url: String
    let headers: [String: String]
    let onFailure: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(page: url, onFailure: onFailure) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Nothing this page stores outlives the view, and it shares no cookies
        // with anything else on the phone.
        configuration.websiteDataStore = .nonPersistent()
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        view.allowsLinkPreview = false
        view.isOpaque = false
        view.backgroundColor = Palette.uiBackground
        view.scrollView.backgroundColor = Palette.uiBackground
        if #available(iOS 16.4, *) { view.isInspectable = false }

        if let target = URL(string: url) {
            var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
            for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
            view.load(request)
        } else {
            onFailure()
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let page: String
        let onFailure: () -> Void

        init(page: String, onFailure: @escaping () -> Void) {
            self.page = page
            self.onFailure = onFailure
        }

        func webView(
            _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            let target = action.request.url?.absoluteString ?? ""
            // A subframe is content, not a person asking to leave, and must never
            // launch the system browser or carry the view anywhere.
            guard action.targetFrame?.isMainFrame ?? true else {
                decisionHandler(.cancel)
                return
            }
            if ArtifactPresentation.mayLoad(target, page: page) {
                decisionHandler(.allow)
                return
            }
            // Only a tap opens the browser. A redirect or a script's navigation is
            // refused outright: failing closed beats letting a page send someone
            // somewhere they did not choose.
            if action.navigationType == .linkActivated, ArtifactPresentation.opensExternally(target, page: page),
               let url = action.request.url {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        /// `window.open` and `target="_blank"`: no second window, the browser instead.
        func webView(
            _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
            for action: WKNavigationAction, windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            let target = action.request.url?.absoluteString ?? ""
            if action.navigationType == .linkActivated, ArtifactPresentation.opensExternally(target, page: page),
               let url = action.request.url {
                UIApplication.shared.open(url)
            }
            return nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            onFailure()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            // A navigation this delegate cancelled reports here too, and is not a failure.
            if (error as NSError).code == NSURLErrorCancelled || (error as NSError).code == 102 { return }
            onFailure()
        }
    }
}

/// The system share sheet.
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#endif
