import Foundation
@testable import SlopcoderCore

/// A scripted transport: answers are consumed in order, the last one repeating,
/// and every request is kept so a test can read the URL, method and body back.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    enum Step {
        case reply(Int, String)
        case fail(Error)

        static func json(_ status: Int, _ body: String = "") -> Step { .reply(status, body) }
    }

    private let lock = NSLock()
    private var steps: [Step] = []
    private(set) var calls: [HTTPRequest] = []

    init(_ steps: Step...) { self.steps = steps }

    func then(_ step: Step) { lock.withLock { steps.append(step) } }
    func reset(_ newSteps: Step...) { lock.withLock { steps = newSteps; calls = [] } }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let step: Step = lock.withLock {
            calls.append(request)
            if steps.count > 1 { return steps.removeFirst() }
            return steps.first ?? .reply(200, "")
        }
        switch step {
        case .reply(let status, let body): return HTTPResponse(status: status, body: Data(body.utf8))
        case .fail(let error): throw error
        }
    }

    var lastURL: String { lock.withLock { calls.last?.url ?? "" } }
    func url(_ index: Int) -> String { lock.withLock { calls[index].url } }
    func body(_ index: Int = 0) -> JSONValue { lock.withLock { calls[index].body.flatMap { JSONValue.parse($0) } ?? .null } }
    func method(_ index: Int = 0) -> String { lock.withLock { calls[index].method } }
    func headers(_ index: Int = 0) -> [String: String] { lock.withLock { calls[index].headers } }
}

final class Recorder<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [T] = []
    func add(_ item: T) { lock.withLock { items.append(item) } }
    var values: [T] { lock.withLock { items } }
}

func fixture(_ name: String) throws -> Data {
    let url = Bundle.module.url(forResource: "Fixtures/\(name)", withExtension: nil)
        ?? Bundle.module.bundleURL.appendingPathComponent("Fixtures/\(name)")
    return try Data(contentsOf: url)
}

/// A transport that answers by what was asked for, for stores that make several
/// kinds of call in an order a test should not have to know.
final class RoutedTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var handler: (HTTPRequest) -> (Int, String)
    private(set) var calls: [HTTPRequest] = []

    init(_ handler: @escaping (HTTPRequest) -> (Int, String)) { self.handler = handler }

    func route(_ handler: @escaping (HTTPRequest) -> (Int, String)) { lock.withLock { self.handler = handler } }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let (status, body): (Int, String) = lock.withLock {
            calls.append(request)
            return handler(request)
        }
        if status < 0 { throw URLError(.cannotConnectToHost) }
        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func count(containing fragment: String) -> Int { lock.withLock { calls.filter { $0.url.contains(fragment) }.count } }
    var urls: [String] { lock.withLock { calls.map(\.url) } }
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
