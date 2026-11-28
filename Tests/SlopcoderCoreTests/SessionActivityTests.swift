// A session-list row's dot: sub-sessions roll up into their parent's row.

import Foundation
import Testing
@testable import SlopcoderCore

private func decode(_ extra: String = "", running: Bool = false) throws -> SessionSummary {
    let json = #"{"id":"a","title":"t","model":"m","autoRoute":true,"status":\#(running ? 1 : 0),"createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"\#(extra)}"#
    return try JSONDecoder().decode(SessionSummary.self, from: Data(json.utf8))
}

private let offlineWorkspace = #","clientWorkspace":{"machineId":"m","machineName":"n","directory":"/p"},"workspaceConnected":false"#

struct SessionActivityTests {
    @Test func anOlderServerThatSendsNoRollupReadsAsBefore() throws {
        let idle = try decode()
        #expect(idle.waitingOnUser == nil)
        #expect(idle.runningSubSessions == nil)
        #expect(SessionActivity(idle) == .idle)
        #expect(SessionActivity(try decode(running: true)) == .working)
    }

    @Test func anIdleParentWithAWorkingSubSessionIsWorking() throws {
        let session = try decode(#","waitingOnUser":false,"runningSubSessions":2"#)
        #expect(SessionActivity(session) == .working)
        #expect(SessionActivity.busy(session))
        #expect(!SessionActivity.busy(try decode(#","runningSubSessions":0"#)))
    }

    @Test func waitingOnTheUserWinsOverEverythingElse() throws {
        #expect(SessionActivity(try decode(#","waitingOnUser":true,"runningSubSessions":1"#, running: true)) == .waiting)
        #expect(SessionActivity(try decode(#","waitingOnUser":true"# + offlineWorkspace)) == .waiting)
    }

    @Test func anOfflineWorkspaceOutranksWorking() throws {
        #expect(SessionActivity(try decode(offlineWorkspace, running: true)) == .offline)
        #expect(SessionActivity(try decode(offlineWorkspace)) == .offline)
    }
}
