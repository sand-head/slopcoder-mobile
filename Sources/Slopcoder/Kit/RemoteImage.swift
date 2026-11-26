#if canImport(UIKit)
import SlopcoderCore
import SwiftUI
import UIKit

/// Loading a transcript's pictures, a few at a time.
///
/// A long transcript can hold dozens of images and opening it must not decode
/// them all at once: no more than `Media.maxDecoding` load together and the rest
/// wait their turn. Decoded images are kept by address, so scrolling back to one
/// does not fetch it again.
actor ImageLoader {
    static let shared = ImageLoader()

    private let cache = NSCache<NSString, UIImage>()
    private var running = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []

    private func enter() async {
        if running >= Media.maxDecoding {
            await withCheckedContinuation { waiting.append($0) }
            return
        }
        running += 1
    }

    private func leave() {
        if waiting.isEmpty {
            running -= 1
        } else {
            waiting.removeFirst().resume()
        }
    }

    func image(_ source: MediaSource, headers: [String: String]) async throws -> UIImage {
        let key = source.uri as NSString
        if let cached = cache.object(forKey: key) { return cached }

        if source.uri.hasPrefix("data:") {
            guard let comma = source.uri.firstIndex(of: ","),
                  let data = Data(base64Encoded: String(source.uri[source.uri.index(after: comma)...])),
                  let image = UIImage(data: data)
            else { throw URLError(.cannotDecodeContentData) }
            cache.setObject(image, forKey: key)
            return image
        }

        await enter()
        defer { leave() }
        guard let url = URL(string: source.uri) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        if source.authed {
            for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let image = UIImage(data: data) else {
            throw URLError(.cannotDecodeContentData)
        }
        cache.setObject(image, forKey: key)
        return image
    }
}

/// A picture in the transcript: bounded, loaded when it scrolls into view, and
/// opened full screen on a tap.
struct InlineImage: View {
    let source: MediaSource
    let label: String
    /// Sized to the image's own shape rather than a fixed frame — for a picture
    /// that is part of the prose.
    var bare = false
    /// What a tap does instead of opening the viewer.
    var onTap: (() -> Void)?

    static let height: CGFloat = 180

    @Environment(AppModel.self) private var model
    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0
    @State private var viewing = false

    var body: some View {
        Group {
            if failed {
                Button {
                    failed = false
                    attempt += 1
                } label: {
                    Text("Could not load this image.\nTap to try again.")
                        .font(AppFont.mono(11.5))
                        .foregroundStyle(Palette.mutedForeground)
                        .multilineTextAlignment(.center)
                        .padding(12)
                        .frame(maxWidth: .infinity)
                        .frame(height: InlineImage.height)
                        .background(Palette.muted.opacity(0.35), in: RoundedRectangle(cornerRadius: Radius.md))
                        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(label). Could not load. Tap to try again.")
            } else if let image {
                Button {
                    if let onTap { onTap() } else { viewing = true }
                } label: {
                    if bare {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity)
                    } else {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity)
                            .frame(height: InlineImage.height)
                            .background(Palette.muted.opacity(0.35))
                            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(label)
                .accessibilityHint("Opens full screen")
                .accessibilityAddTraits(.isImage)
            } else {
                ProgressView()
                    .tint(Palette.mutedForeground)
                    .frame(maxWidth: .infinity)
                    .frame(height: InlineImage.height)
                    .background(Palette.muted.opacity(0.35), in: RoundedRectangle(cornerRadius: Radius.md))
            }
        }
        // `.task` starts when the row is on screen, which is the whole of "only
        // ask once it has been seen".
        .task(id: attempt) {
            guard image == nil else { return }
            do {
                image = try await ImageLoader.shared.image(source, headers: model.seam?.authHeaders ?? [:])
            } catch is CancellationError {
                return
            } catch {
                failed = true
            }
        }
        .fullScreenCover(isPresented: $viewing) {
            if let image { ImageViewer(image: image, label: label) }
        }
    }
}

/// A photo, full screen: pinch and double-tap to zoom, drag to pan.
struct ImageViewer: View {
    let image: UIImage
    let label: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            ZoomableImage(image: image).ignoresSafeArea().accessibilityLabel(label)
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Color.white.opacity(0.18), in: Circle())
            }
            .padding(.trailing, 16)
            .padding(.top, 8)
            .accessibilityLabel("Close image")
        }
    }
}

/// `UIScrollView` does zooming properly — rubber-banding, momentum, centring —
/// and SwiftUI's gestures do not, so this is the scroll view.
struct ZoomableImage: UIViewRepresentable {
    let image: UIImage

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 6
        scroll.bouncesZoom = true
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.backgroundColor = .black
        scroll.contentInsetAdjustmentBehavior = .never

        let view = UIImageView(image: image)
        view.contentMode = .scaleAspectFit
        view.frame = scroll.bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.addSubview(view)
        context.coordinator.imageView = view

        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.imageView?.image = image
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        @objc func doubleTapped(_ recognizer: UITapGestureRecognizer) {
            guard let scroll = recognizer.view as? UIScrollView else { return }
            if scroll.zoomScale > 1 {
                scroll.setZoomScale(1, animated: true)
                return
            }
            // Zoom toward the point that was tapped, not the middle.
            let point = recognizer.location(in: imageView)
            let size = CGSize(width: scroll.bounds.width / 3, height: scroll.bounds.height / 3)
            scroll.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
        }
    }
}

/// A picture a tool returned or a scene tool rendered, kept by the server with
/// the transcript; owner-only, so fetched with the device's key.
struct KeptImage: View {
    enum Kind { case tool, scene }

    let kind: Kind
    let id: String
    let label: String
    @Environment(AppModel.self) private var model

    var body: some View {
        if let seam = model.seam {
            InlineImage(
                source: MediaSource(uri: kind == .tool ? seam.toolImageUrl(id) : seam.sceneRenderUrl(id), authed: true),
                label: label
            )
        }
    }
}
#endif
