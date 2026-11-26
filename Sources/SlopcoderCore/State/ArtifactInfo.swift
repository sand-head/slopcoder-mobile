// What a transcript's artifact card needs to know before it can show the
// artifact inline: its content type and size.
//
// The card event carries a name, a kind and an id, not a content type, so a
// binary artifact ("File") has to be asked about. A long transcript can hold
// dozens of those, and opening it must not become dozens of requests: so a
// card only asks once it has been on screen, every card for one artifact
// shares one request, and no more than `maxConcurrent` are in flight at once —
// the rest wait their turn in the order they were asked for.
//
// Only the summary is kept, never a body; it is held for the life of the
// signed-in seam, like the transcript it belongs to. A failure is not
// remembered, so the next look retries; "gone" (a 404) is.

import Foundation

public actor ArtifactInfoCache {
    public static let maxConcurrent = 2

    public enum Known: Sendable, Equatable {
        case summary(ArtifactSummary)
        /// Gone, or never this account's.
        case gone
    }

    private let fetch: @Sendable (String) async throws -> ArtifactDetail?
    private var done: [String: Known] = [:]
    private var inflight: [String: Task<Known, Error>] = [:]
    private var running = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []

    public init(fetch: @escaping @Sendable (String) async throws -> ArtifactDetail?) {
        self.fetch = fetch
    }

    public init(seam: Seam) {
        self.init { try await seam.artifact($0) }
    }

    /// Already known, without asking; nil for not yet.
    public func known(_ id: String) -> Known? { done[id] }

    /// The summary, shared with every other caller asking about the same artifact.
    public func info(_ id: String) async throws -> Known {
        if let known = done[id] { return known }
        if let pending = inflight[id] { return try await pending.value }

        let request = Task<Known, Error> {
            await self.enter()
            do {
                let detail = try await self.fetch(id)
                await self.leave()
                // Keep the summary only: a text body has no business in this cache.
                return detail.map { .summary($0.artifact) } ?? .gone
            } catch {
                await self.leave()
                throw error
            }
        }
        inflight[id] = request
        defer { inflight[id] = nil }
        let known = try await request.value
        done[id] = known
        return known
    }

    private func enter() async {
        if running >= ArtifactInfoCache.maxConcurrent {
            // The slot is handed over by `leave`, already counted.
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
}
