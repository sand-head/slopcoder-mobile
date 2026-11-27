import Foundation
@testable import SlopcoderCore

/// A scripted transport: answers are consumed in order, the last one repeating,
/// and every request is kept so a test can read the URL, method and body back.
final class FakeTransport: HTTPTransport {
    enum Step: Sendable {
        case reply(Int, String)
        case fail(Error)

        static func json(_ status: Int, _ body: String = "") -> Step { .reply(status, body) }
    }

    private struct State: Sendable {
        var steps: [Step]
        var calls: [HTTPRequest] = []
    }

    private let state: Locked<State>

    init(_ steps: Step...) { state = Locked(State(steps: steps)) }

    var calls: [HTTPRequest] { state.withLock { $0.calls } }

    func then(_ step: Step) { state.withLock { $0.steps.append(step) } }
    func reset(_ newSteps: Step...) { state.withLock { $0 = State(steps: newSteps) } }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let step: Step = state.withLock { state in
            state.calls.append(request)
            if state.steps.count > 1 { return state.steps.removeFirst() }
            return state.steps.first ?? .reply(200, "")
        }
        switch step {
        case .reply(let status, let body): return HTTPResponse(status: status, body: Data(body.utf8))
        case .fail(let error): throw error
        }
    }

    var lastURL: String { calls.last?.url ?? "" }
    func url(_ index: Int) -> String { calls[index].url }
    func body(_ index: Int = 0) -> JSONValue { calls[index].body.flatMap { JSONValue.parse($0) } ?? .null }
    func method(_ index: Int = 0) -> String { calls[index].method }
    func headers(_ index: Int = 0) -> [String: String] { calls[index].headers }
}

final class Recorder<T: Sendable>: Sendable {
    private let items = Locked<[T]>([])
    func add(_ item: T) { items.withLock { $0.append(item) } }
    var values: [T] { items.withLock { $0 } }
}

func fixture(_ name: String) throws -> Data {
    let url = Bundle.module.url(forResource: "Fixtures/\(name)", withExtension: nil)
        ?? Bundle.module.bundleURL.appendingPathComponent("Fixtures/\(name)")
    return try Data(contentsOf: url)
}

/// A transport that answers by what was asked for, for stores that make several
/// kinds of call in an order a test should not have to know.
final class RoutedTransport: HTTPTransport {
    typealias Handler = @Sendable (HTTPRequest) -> (Int, String)

    private struct State: Sendable {
        var handler: Handler
        var calls: [HTTPRequest] = []
    }

    private let state: Locked<State>

    init(_ handler: @escaping Handler) { state = Locked(State(handler: handler)) }

    func route(_ handler: @escaping Handler) { state.withLock { $0.handler = handler } }

    var calls: [HTTPRequest] { state.withLock { $0.calls } }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let (status, body): (Int, String) = state.withLock { state in
            state.calls.append(request)
            return state.handler(request)
        }
        if status < 0 { throw URLError(.cannotConnectToHost) }
        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func count(containing fragment: String) -> Int { calls.filter { $0.url.contains(fragment) }.count }
    var urls: [String] { calls.map(\.url) }
}

/// Polls on the main actor until `condition` holds.
@MainActor
func settled(_ condition: @MainActor () -> Bool) async -> Bool {
    for _ in 0..<400 {
        if condition() { return true }
        try? await Task.sleep(nanoseconds: 5_000_000)
    }
    return condition()
}
