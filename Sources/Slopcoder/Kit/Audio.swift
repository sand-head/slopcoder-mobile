#if canImport(UIKit)
import AVFoundation
import SlopcoderCore
import SwiftUI

/// An audio artifact, played where it stands.
///
/// Nothing is fetched until Play is pressed. The file is owner-only, so the
/// player is given the device's key as request headers rather than a URL anyone
/// could replay.
struct InlineAudio: View {
    let url: String
    let headers: [String: String]
    let title: String

    private enum Phase { case idle, loading, playing, paused, failed }

    @State private var phase = Phase.idle
    @State private var player: AVPlayer?
    @State private var ended: NSObjectProtocol?

    private var label: String {
        switch phase {
        case .idle: return "Play audio"
        case .loading: return "Loading audio"
        case .playing: return "Pause"
        case .paused: return "Resume"
        case .failed: return "Could not load this audio. Tap to try again."
        }
    }

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 8) {
                if phase == .loading {
                    ProgressView().tint(Palette.mutedForeground)
                } else {
                    Image(systemName: phase == .playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(phase == .failed ? Palette.destructive : Palette.foreground)
                }
                Text(label).font(AppFont.mono(12)).foregroundStyle(phase == .failed ? Palette.destructive : Palette.foreground)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 40)
            .background(Palette.muted.opacity(0.35), in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(phase == .loading)
        .accessibilityLabel(phase == .failed ? "Audio \(title) could not be loaded. Try again." : "\(label): \(title)")
        .onDisappear(perform: stop)
    }

    private func toggle() {
        switch phase {
        case .playing:
            player?.pause()
            phase = .paused
        case .paused:
            player?.play()
            phase = .playing
        case .idle, .failed:
            start()
        case .loading:
            break
        }
    }

    private func start() {
        guard let target = URL(string: url) else {
            phase = .failed
            return
        }
        phase = .loading
        let asset = AVURLAsset(url: target, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        let item = AVPlayerItem(asset: asset)
        let player = AVPlayer(playerItem: item)
        self.player = player
        ended = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { _ in
            player.seek(to: .zero)
            phase = .idle
        }
        Task {
            // Loading the duration is what proves the file is there and is audio.
            do {
                _ = try await asset.load(.duration)
                try? AVAudioSession.sharedInstance().setCategory(.playback)
                player.play()
                phase = .playing
            } catch {
                phase = .failed
            }
        }
    }

    private func stop() {
        player?.pause()
        player = nil
        if let ended { NotificationCenter.default.removeObserver(ended) }
        ended = nil
        if phase != .failed { phase = .idle }
    }
}
#endif
