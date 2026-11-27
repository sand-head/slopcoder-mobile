// The routine editor's decisions: what opening it fills in, when the form may
// be saved and what a save sends, how a draft fills only the untouched fields,
// and how a stored cron comes back as English.

import Foundation
import Testing
@testable import SlopcoderCore

private let stored = #"{"routine":{"id":"r1","name":"morning-digest","kind":0,"prompt":"check the deploy","cronExpression":"0 7 * * 1-5","timeZoneId":"Europe/London","enabled":false,"scheduleEnabled":true,"facet":"execute","repoUrls":[],"nodeIds":[],"continuity":false,"notepad":"","deliveryKind":1,"triggers":[],"createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"},"scheduleSentence":"","scheduleMeta":"","notifiesLabel":"","history":[],"runs30d":0,"notified30d":0,"failed30d":0}"#

/// What the server reads a schedule as: the cron as English, the English as the cron.
private func readSchedule(_ request: HTTPRequest) -> (Int, String) {
    let text = request.body.flatMap { JSONValue.parse($0) }?["text"].string ?? ""
    switch text {
    case "0 7 * * 1-5", "every weekday at 7am":
        return (200, #"{"ok":true,"cron":"0 7 * * 1-5","zone":"Europe/London","sentence":"every weekday at 7am"}"#)
    case "whenever":
        return (200, #"{"ok":false,"error":"couldn't read that"}"#)
    default:
        return (200, #"{"ok":true,"cron":"0 9 * * *","zone":"UTC","sentence":"every day at 9am"}"#)
    }
}

@MainActor
final class EditorServer {
    /// Answers ahead of the defaults; nil passes the request on.
    var answer: @Sendable (HTTPRequest) -> (Int, String)? = { _ in nil }
    let transport: RoutedTransport
    let felt = Felt()
    let router = Router()

    init() { transport = RoutedTransport { _ in (204, "") } }

    func model(_ routineId: String? = nil, addTrigger: Bool = false) -> RoutineEditorModel {
        let answer = self.answer
        transport.route { request in
            if let given = answer(request) { return given }
            let path = request.url.replacingOccurrences(of: "https://s/api/seam/", with: "")
            if path == "automations/schedule" { return readSchedule(request) }
            if path == "automations/r1/detail" { return (200, stored) }
            if path.hasSuffix("/detail") { return (404, "") }
            if path == "git/repos" { return (200, #"{"repos":[],"errors":[]}"#) }
            if path.hasPrefix("facets") { return (200, #"[{"name":"execute","description":""}]"#) }
            if request.method == "GET" { return (200, "[]") }
            return (204, "")
        }
        let seam = Seam(baseUrl: "https://s", apiKey: "k", transport: transport)
        return RoutineEditorModel(
            routineId: routineId, addTrigger: addTrigger, seam: { seam }, router: router,
            feedback: felt.feedback, timeZone: "Europe/London", debounce: { _ in }
        )
    }

    func calls(_ path: String, _ method: String? = nil) -> [HTTPRequest] {
        transport.calls.filter { $0.url == "https://s/api/seam/\(path)" && (method == nil || $0.method == method) }
    }

    func body(_ path: String, _ method: String? = nil) -> JSONValue {
        calls(path, method).last?.body.flatMap { JSONValue.parse($0) } ?? .null
    }
}

/// A new form, named and prompted, with a schedule the server has read.
@MainActor
private func filled(_ server: EditorServer) async -> RoutineEditorModel {
    let model = server.model()
    _ = await model.load()
    model.setName("  morning-digest ")
    model.setPrompt("check the deploy")
    let key = model.form.triggers[0].key
    model.pickSlot(model.form.triggers[0], .schedule)
    model.scheduleTyped(key, "every weekday at 7am")
    _ = await settled { model.card(key)?.parse?.ok == true }
    return model
}

@MainActor
@Suite struct RoutineEditorModelTests {
    @Test func aNewRoutineOpensOnOneEmptyTriggerAndIsNotYetDirty() async {
        let server = EditorServer()
        let model = server.model()
        #expect(model.title == "New routine")
        #expect(await model.load() == .form)
        #expect(model.loaded)
        #expect(model.form.triggers.count == 1)
        #expect(model.form.triggers[0].slot == .none)
        #expect(model.dirty == false)
        #expect(model.ready == false)
        #expect(RoutineEditor.formProblem(model.form) == "give it a name")
        // Opened once: a second appearance reads nothing again.
        let reads = server.transport.calls.count
        _ = await model.load()
        #expect(server.transport.calls.count == reads)
    }

    @Test func anExistingRoutineFillsTheFormAndItsCronBecomesEnglish() async {
        let server = EditorServer()
        let model = server.model("r1")
        #expect(await model.load() == .form)
        #expect(model.title == "Edit morning-digest")
        #expect(model.form.name == "morning-digest")
        #expect(model.form.delivery == "push")
        #expect(model.loadedEnabled == false)
        let schedule = model.form.triggers.first { $0.slot == .schedule }
        #expect(schedule?.when == "0 7 * * 1-5")
        #expect(schedule?.rawCron == true)

        await model.readStoredSchedule()
        let read = model.form.triggers.first { $0.slot == .schedule }
        #expect(read?.when == "every weekday at 7am")
        #expect(read?.rawCron == false)
        #expect(read?.parse?.cron == "0 7 * * 1-5")
        // The English was read back to be sure it means the same cron.
        let texts = server.calls("automations/schedule").compactMap { $0.body.flatMap { JSONValue.parse($0) }?["text"].string }
        #expect(texts == ["0 7 * * 1-5", "every weekday at 7am"])
        #expect(model.dirty == false)
    }

    @Test func aCronWhoseEnglishReadsBackDifferentlyStaysACron() async {
        let server = EditorServer()
        server.answer = { request in
            guard request.url.hasSuffix("automations/schedule") else { return nil }
            let text = request.body.flatMap { JSONValue.parse($0) }?["text"].string
            return text == "0 7 * * 1-5"
                ? (200, #"{"ok":true,"cron":"0 7 * * 1-5","sentence":"weekday mornings"}"#)
                : (200, #"{"ok":true,"cron":"0 8 * * *"}"#)
        }
        let model = server.model("r1")
        _ = await model.load()
        await model.readStoredSchedule()
        let read = model.form.triggers.first { $0.slot == .schedule }
        #expect(read?.when == "0 7 * * 1-5")
        #expect(read?.rawCron == true)
        #expect(read?.parse?.sentence == "weekday mornings")
        #expect(read?.parsing == false)
    }

    @Test func theHeartbeatIsNotAFormAndAMissingRoutineSaysSo() async {
        let server = EditorServer()
        server.answer = { request in
            request.url.hasSuffix("automations/r1/detail") ? (200, stored.replacingOccurrences(of: #""kind":0"#, with: #""kind":1"#)) : nil
        }
        let beat = server.model("r1")
        #expect(await beat.load() == .heartbeat)
        #expect(beat.loaded == false)

        let missing = EditorServer().model("gone")
        #expect(await missing.load() == .form)
        #expect(missing.error == "That routine could not be loaded.")
        #expect(missing.loaded)
    }

    @Test func openedToAddATriggerHasACardWaitingAndCountsAsAChange() async {
        let server = EditorServer()
        let model = server.model("r1", addTrigger: true)
        guard case .addingTrigger(let key) = await model.load() else {
            Issue.record("expected a card to edit")
            return
        }
        #expect(model.card(key)?.slot == TriggerSlot.none)
        #expect(model.dirty)
    }

    @Test func readsATypedScheduleAndSavesTheFormAsADraft() async {
        let server = EditorServer()
        server.answer = { request in
            if request.url.hasSuffix("api/seam/automations/"), request.method == "POST" { return (200, #"{"webhooks":[]}"#) }
            if request.url.hasSuffix("api/seam/automations/"), request.method == "GET" {
                return (200, #"[{"id":"old","name":"morning-digest","kind":0,"createdAt":"2026-01-01T00:00:00Z"},{"id":"new","name":"morning-digest","kind":0,"createdAt":"2026-11-27T09:00:00Z"},{"id":"beat","name":"morning-digest","kind":1,"createdAt":"2026-12-01T00:00:00Z"}]"#)
            }
            return nil
        }
        let model = await filled(server)
        #expect(server.body("automations/schedule") == ["text": "every weekday at 7am", "timeZoneId": "Europe/London"])
        #expect(model.ready)
        #expect(model.dirty)

        #expect(await model.save(thenRun: false) == .done)
        let draft = server.body("automations/", "POST")
        #expect(draft["name"] == "morning-digest")
        #expect(draft["prompt"] == "check the deploy")
        #expect(draft["cronExpression"] == "0 7 * * 1-5")
        #expect(draft["timeZoneId"] == "Europe/London")
        #expect(draft["enabled"] == true)
        #expect(draft["triggers"] == [])
        #expect(model.dirty == false)
        // No webhook, so no id in the answer: the newest job of that name is it.
        #expect(model.savedId == "new")
        #expect(server.felt.names == ["select", "confirm"])

        // Opened from the routines tab, the new routine opens beside its list.
        server.router.tab = .routines
        model.openSaved()
        #expect(server.router.routines == [.routine(id: "new", run: nil)])
    }

    @Test func aRefusedSaveSaysWhyAndKeepsTheForm() async {
        let server = EditorServer()
        server.answer = { request in
            request.url.hasSuffix("api/seam/automations/") && request.method == "POST" ? (200, #"{"error":"A routine with that name exists.","webhooks":[]}"#) : nil
        }
        let model = await filled(server)
        #expect(await model.save(thenRun: true) == nil)
        #expect(model.error == "A routine with that name exists.")
        #expect(model.dirty)
        #expect(server.calls("automations/new/run").isEmpty)
        #expect(server.felt.names.last == "error")
    }

    @Test func anOfflineSaveSavesNothingAndSaysSo() async {
        let server = EditorServer()
        server.answer = { request in request.method == "POST" && request.url.hasSuffix("api/seam/automations/") ? (-1, "") : nil }
        let model = await filled(server)
        #expect(await model.save(thenRun: false) == nil)
        #expect(model.error == "The server could not be reached. Nothing was saved.")
        #expect(model.saving == false)
    }

    @Test func savingAnExistingRoutineKeepsItsSwitchAndShowsANewSecret() async {
        let server = EditorServer()
        server.answer = { request in
            request.url.hasSuffix("automations/r1") && request.method == "PUT"
                ? (200, #"{"webhooks":[{"automationId":"r1","triggerId":"t1","secret":"s3cret"}]}"#) : nil
        }
        let model = server.model("r1")
        _ = await model.load()
        await model.readStoredSchedule()
        #expect(model.ready)
        #expect(await model.save(thenRun: false) == .showSecrets)
        #expect(server.body("automations/r1", "PUT")["enabled"] == false)
        #expect(model.minted.map(\.secret) == ["s3cret"])
        // An edit does not open anything new when it closes.
        model.openSaved()
        #expect(server.router.routines.isEmpty)
    }

    @Test func runOnceAfterSavingOrSayWhyItWouldNot() async {
        let server = EditorServer()
        server.answer = { request in
            if request.url.hasSuffix("automations/r1") && request.method == "PUT" { return (200, #"{"webhooks":[]}"#) }
            if request.url.hasSuffix("automations/r1/run") { return (200, #"{"value":"The routine is paused."}"#) }
            return nil
        }
        let model = server.model("r1")
        _ = await model.load()
        await model.readStoredSchedule()
        #expect(await model.save(thenRun: true) == nil)
        #expect(server.calls("automations/r1/run").count == 1)
        #expect(model.error == "The routine is paused.")
    }

    @Test func aDraftFillsOnlyWhatWasNotTyped() async {
        let server = EditorServer()
        server.answer = { request in
            request.url.hasSuffix("automations/draft")
                ? (200, #"{"ok":true,"name":"deploy-watch","prompt":"Check the deploy.","triggers":[{"when":"every day at 9am"}],"deliveryKind":0,"reading":["every day at 9am","tells nobody"],"elapsedMs":2400,"draftedBy":"gpt-5"}"#)
                : nil
        }
        let model = server.model()
        _ = await model.load()
        model.setName("my-own-name")
        model.description = "  every morning check the deploy  "
        #expect(model.canDraft)
        await model.draft()

        #expect(server.body("automations/draft") == ["description": "every morning check the deploy", "timeZoneId": "Europe/London"])
        #expect(model.form.name == "my-own-name")
        #expect(model.form.prompt == "Check the deploy.")
        #expect(model.form.delivery == "none")
        #expect(model.form.triggers.map(\.slot) == [.schedule])
        // The proposed schedule was read at once, not after a pause.
        #expect(model.form.triggers[0].parse?.cron == "0 9 * * *")
        #expect(model.reading == ["every day at 9am", "tells nobody"])
        #expect(model.draftedBy == "gpt-5")
        #expect(model.draftElapsedMs == 2400)
        #expect(model.touched == RoutineEditorModel.Touched())
        #expect(model.dirty)
        #expect(server.felt.names == ["success"])
    }

    @Test func aTouchedTriggerListSurvivesARedraft() async {
        let server = EditorServer()
        server.answer = { request in
            request.url.hasSuffix("automations/draft") ? (200, #"{"ok":true,"triggers":[{"when":"every day at 9am"}],"deliveryKind":1,"reading":[],"elapsedMs":10}"#) : nil
        }
        let model = server.model()
        _ = await model.load()
        let key = model.form.triggers[0].key
        model.pickSlot(model.form.triggers[0], .webhook)
        model.description = "x"
        await model.draft()
        #expect(model.form.triggers.map(\.key) == [key])
        #expect(model.form.triggers[0].slot == .webhook)
    }

    @Test func aDraftThatFailedSaysWhyInTheServersWordsOrOurs() async {
        let server = EditorServer()
        server.answer = { request in
            request.url.hasSuffix("automations/draft") ? (200, #"{"ok":false,"triggers":[],"deliveryKind":0,"reading":[],"elapsedMs":900}"#) : nil
        }
        let model = server.model()
        _ = await model.load()
        model.description = "x"
        await model.draft()
        #expect(model.error == "No model could draft that. Fill the form in yourself.")
        #expect(model.draftElapsedMs == 900)
        #expect(model.drafting == false)

        let offline = EditorServer()
        offline.answer = { request in request.url.hasSuffix("automations/draft") ? (-1, "") : nil }
        let unreachable = offline.model()
        _ = await unreachable.load()
        unreachable.description = "x"
        await unreachable.draft()
        #expect(unreachable.error == "Drafting could not reach the server. Fill the form in yourself.")
        #expect(offline.felt.names == ["error"])
    }

    @Test func aBlankDescriptionDraftsNothing() async {
        let server = EditorServer()
        let model = server.model()
        _ = await model.load()
        model.description = "   "
        #expect(model.canDraft == false)
        await model.draft()
        #expect(server.calls("automations/draft").isEmpty)
    }

    @Test func anUnreadableScheduleIsSaidOnTheCardAndBlocksTheSave() async {
        let server = EditorServer()
        let model = server.model()
        _ = await model.load()
        model.setName("n")
        model.setPrompt("p")
        let card = model.form.triggers[0]
        model.pickSlot(card, .schedule)
        model.scheduleTyped(card.key, "whenever")
        #expect(await settled { model.card(card.key)?.parsing == false && model.card(card.key)?.parse != nil })
        #expect(RoutineEditor.problem(model.card(card.key)!) == "couldn't read that")
        #expect(model.ready == false)
        #expect(RoutineEditor.formProblem(model.form) == "add a trigger that would fire")

        // Clearing the words clears the reading, with no call.
        let asked = server.calls("automations/schedule").count
        model.scheduleTyped(card.key, "  ")
        #expect(model.card(card.key)?.parse == nil)
        #expect(server.calls("automations/schedule").count == asked)
    }

    @Test func anotherZoneRereadsEverySchedule() async {
        let server = EditorServer()
        let model = await filled(server)
        let asked = server.calls("automations/schedule").count
        model.setTimeZone("America/New_York")
        #expect(await settled { server.calls("automations/schedule").count == asked + 1 })
        #expect(server.body("automations/schedule")["timeZoneId"] == "America/New_York")
    }

    @Test func aSecondScheduleCannotBePickedAndATakenSlotChangesNothing() async {
        let server = EditorServer()
        let model = await filled(server)
        let second = model.addCard()
        let before = model.form
        model.pickSlot(model.card(second)!, .schedule)
        #expect(model.form == before)
        #expect(server.felt.names == ["select"])
    }

    @Test func everyEditMakesTheFormDirtyAndRemovingACardIsOne() async {
        let server = EditorServer()
        let model = server.model()
        _ = await model.load()
        #expect(model.dirty == false)
        model.setActiveStart("07:00")
        #expect(model.dirty)

        let fresh = server.model()
        _ = await fresh.load()
        fresh.removeCard(fresh.form.triggers[0].key)
        #expect(fresh.form.triggers.isEmpty)
        #expect(fresh.dirty)
        #expect(fresh.touched.triggers)

        let picked = server.model()
        _ = await picked.load()
        picked.pickModel("gpt-5")
        #expect(picked.dirty)
        #expect(picked.modelLabel == "gpt-5")
    }
}
