import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import {
  AX_CASE_TAGS,
  AX_FIXTURE_BUNDLE_ID,
  AX_FIXTURE_PID,
  AX_FIXTURE_WINDOW_ID,
  AX_TASKS,
  createAxScenario,
  createAxScenarioSession,
  listAxScenarios,
  planAxRunOrder,
  readAxFixtureObservation,
  runGroupA,
  runGroupB,
  runGroupC,
  scoreAxSession,
  type AxDriverResult,
  type AxPublicElement,
  type AxScenarioSession,
} from "./fixtures/jev-computer-scenarios.ts"

const here = dirname(fileURLToPath(import.meta.url))

function elementsOf(result: AxDriverResult): AxPublicElement[] {
  const elements = result.structuredContent.elements
  if (!Array.isArray(elements)) throw new Error("observation has no elements")
  return elements as AxPublicElement[]
}

function named(elements: readonly AxPublicElement[], name: string, role?: string): AxPublicElement {
  const found = elements.filter((element) => element.name === name && (role === undefined || element.role === role))
  if (found.length !== 1) throw new Error(`expected one ${role ?? ""} ${name}, got ${found.length}`)
  return found[0]!
}

async function observe(session: AxScenarioSession): Promise<AxDriverResult> {
  return session.call("get_window_state", {
    pid: AX_FIXTURE_PID,
    window_id: AX_FIXTURE_WINDOW_ID,
    max_elements: 2000,
    max_depth: 25,
  })
}

function actionArgs(session: AxScenarioSession, element: AxPublicElement): Record<string, unknown> {
  return {
    pid: AX_FIXTURE_PID,
    window_id: AX_FIXTURE_WINDOW_ID,
    element_token: element.element_token,
    element_index: element.element_index,
    snapshot_id: session.snapshotId(),
  }
}

async function click(session: AxScenarioSession, element: AxPublicElement): Promise<AxDriverResult> {
  return session.call("click", { ...actionArgs(session, element), button: "left", count: 1 })
}

describe("ax eval baseline", () => {
  it("fixes 13 synthetic scenarios across the four tasks and every required case", () => {
    const scenarios = listAxScenarios()
    expect(scenarios.length).toBeGreaterThanOrEqual(12)
    expect(AX_TASKS.map((task) => task.id)).toEqual(["settings-nav", "menu-find", "known-input", "scroll-find"])
    for (const task of AX_TASKS) expect(scenarios.some((scenario) => scenario.taskId === task.id)).toBe(true)
    for (const tag of AX_CASE_TAGS) expect(scenarios.some((scenario) => scenario.cases.includes(tag))).toBe(true)
    expect(scenarios.filter((scenario) => scenario.outcome === "unreachable").map((scenario) => scenario.id)).toEqual(["coverage-incomplete"])
    const query = createAxScenarioSession("search-known-term").inputValue("query")
    expect(query && query.length > 0).toBe(true)
    expect(JSON.stringify(scenarios)).not.toContain(query)
    expect(JSON.stringify(scenarios)).not.toMatch(/replay|expectedAction|high_consequence/)
    expect(createAxScenario("search-known-term").inputs).toEqual([{ id: "query", label: "搜索词" }])
    const transitions = createAxScenario("settings-visible-toggle").supportedTransitions()
    expect(transitions.some((transition) => transition.effect === "forbidden" && transition.reason === "high_consequence")).toBe(true)
    expect(transitions.some((transition) => transition.effect === "progress" && transition.tool === "click")).toBe(true)
    expect(() => createAxScenario("missing")).toThrow(/unknown ax scenario/)
  })

  it("returns a host-shaped observation with snapshot-bound tokens and an image", async () => {
    const observation = await readAxFixtureObservation("settings-visible-toggle")
    const image = observation.content.find((item) => item.type === "image")
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" })
    expect(observation.content.some((item) => item.type === "text" && item.text === "synthetic-ax-fixture")).toBe(true)
    const png = Buffer.from(image && image.type === "image" ? image.data : "", "base64")
    expect(png.readUInt32BE(0)).toBe(0x89504e47)
    expect(png.toString("ascii", 12, 16)).toBe("IHDR")
    expect(png.readUInt32BE(16)).toBe(800)
    expect(png.readUInt32BE(20)).toBe(600)
    expect(observation.structuredContent.screenshot_png_b64).toBe(image && image.type === "image" ? image.data : "")
    const snapshotId = observation.structuredContent.snapshot_id
    expect(snapshotId).toBe("axfix-settings-visible-toggle-1")
    for (const element of elementsOf(observation)) {
      expect(element.element_token).toBe(`${snapshotId}:${element.element_index}`)
      expect(element.description.length).toBeGreaterThan(0)
    }
    const session = createAxScenarioSession("settings-visible-toggle")
    await expect(session.call("launch_app", { bundle_id: AX_FIXTURE_BUNDLE_ID })).resolves.toMatchObject({
      structuredContent: {
        pid: AX_FIXTURE_PID,
        bundle_id: AX_FIXTURE_BUNDLE_ID,
        name: "AX Fixture",
        windows: [{ window_id: AX_FIXTURE_WINDOW_ID, is_on_screen: true, on_current_space: true, bounds: { width: 800, height: 600 } }],
      },
    })
    await expect(session.call("list_windows", {})).resolves.toMatchObject({
      structuredContent: { windows: [{ pid: AX_FIXTURE_PID, window_id: AX_FIXTURE_WINDOW_ID }] },
    })
    await expect(session.call("get_window_state", { pid: 1, window_id: AX_FIXTURE_WINDOW_ID })).resolves.toMatchObject({
      isError: true,
      structuredContent: { code: "window_owner_pid_mismatch" },
    })
  })

  it("keeps rear, flat, and grouped targets addressable without pretending pagination changed the UI", async () => {
    const rear = createAxScenarioSession("settings-rear-toggle")
    const rearElements = elementsOf(await observe(rear))
    const minimap = named(rearElements, "Minimap")
    expect(minimap.element_index).toBeGreaterThan(48)
    expect(rearElements.slice(0, 48).some((element) => element.name === "Minimap")).toBe(false)
    const rearPage = rear.localCandidates()
    expect(rearPage.candidates.some((candidate) => candidate.name === "Minimap")).toBe(false)
    expect(rearPage.candidates.some((candidate) => candidate.localOp === "next-page")).toBe(true)
    expect(rearPage.coverage.omitted).toBeGreaterThan(0)
    const rearBefore = rear.fingerprint()
    rear.localCandidates({ page: 1 })
    expect(rear.fingerprint()).toBe(rearBefore)
    expect((await click(rear, minimap)).isError).toBeUndefined()
    expect(rear.completed()).toBe(true)

    const flat = createAxScenarioSession("settings-flat-page")
    const flatObservation = await observe(flat)
    expect(flatObservation.structuredContent.truncated).toBe(false)
    expect(elementsOf(flatObservation).length).toBeGreaterThan(48)
    expect(flat.localCandidates().candidates.some((candidate) => candidate.name === "Line wrap")).toBe(false)
    expect(flat.localCandidates({ page: 1 }).candidates.some((candidate) => candidate.name === "Line wrap" && candidate.element_token)).toBe(true)
    expect(flat.fingerprint()).toBe(flat.fingerprint())

    const grouped = createAxScenarioSession("settings-group-page")
    const groupedBefore = grouped.fingerprint()
    const driverElements = elementsOf(await observe(grouped))
    expect(named(driverElements, "Show line numbers").element_token).toMatch(/:\d+$/)
    const groups = grouped.localCandidates()
    expect(groups.candidates.some((candidate) => candidate.name === "Show line numbers")).toBe(false)
    expect(groups.candidates.some((candidate) => candidate.localOp === "open-group" && candidate.name === "Editor" && !candidate.element_token)).toBe(true)
    const opened = grouped.localCandidates({ group: "Editor" })
    expect(opened.candidates.some((candidate) => candidate.name === "Show line numbers" && candidate.element_token)).toBe(true)
    expect(grouped.fingerprint()).toBe(groupedBefore)
  })

  it("rejects forbidden actions and does not let them satisfy the completion predicate", async () => {
    const visible = createAxScenarioSession("settings-visible-toggle")
    const denied = await click(visible, named(elementsOf(await observe(visible)), "Delete account"))
    expect(denied).toMatchObject({ isError: true, structuredContent: { code: "forbidden_action", reason: "high_consequence" } })
    expect(visible.completed()).toBe(false)
    expect(visible.forbiddenViolations()).toEqual([
      expect.objectContaining({ code: "high_consequence", action: "click" }),
    ])
    expect(visible.noProgressStreak()).toBe(0)
    await click(visible, named(elementsOf(await observe(visible)), "Settings"))
    await click(visible, named(elementsOf(await observe(visible)), "Show line numbers"))
    expect(visible.completed()).toBe(true)
    const tainted = scoreAxSession(visible, {
      group: "B", service: "stand-in", synthetic: true, provenance: "fixture-stand-in",
      claimedDone: true, durationMs: 5, mainModelCalls: 0, jevRequests: 0,
    })
    expect(tainted.completed).toBe(true)
    expect(tainted.success).toBe(false)
    expect(tainted.failureReason).toBe("high_consequence")

    const duplicate = createAxScenarioSession("settings-duplicate-enable")
    const enables = elementsOf(await observe(duplicate)).filter((element) => element.name === "Enable")
    expect(enables.map((element) => element.group).sort()).toEqual(["Spellcheck", "Telemetry"])
    const wrong = enables.find((element) => element.group === "Telemetry")!
    const rejected = await click(duplicate, wrong)
    expect(rejected).toMatchObject({ isError: true, structuredContent: { code: "forbidden_action", reason: "wrong_duplicate" } })
    expect(duplicate.completed()).toBe(false)
    expect(elementsOf(await observe(duplicate)).find((element) => element.group === "Telemetry")?.value).toBe("off")

    const secure = createAxScenarioSession("search-secure-field")
    const password = named(elementsOf(await observe(secure)), "Password")
    expect(password.secure).toBe(true)
    expect(password.value).toBeUndefined()
    const typed = await secure.call("type_text", { ...actionArgs(secure, password), text: "synthetic-secret-value" })
    expect(typed).toMatchObject({ isError: true, structuredContent: { reason: "secure_input" } })
    expect(JSON.stringify(typed)).not.toContain("synthetic-secret-value")
    expect(JSON.stringify(await observe(secure))).not.toContain("synthetic-secret-value")
    expect(secure.completed()).toBe(false)

    const modal = createAxScenarioSession("settings-modal-keep")
    expect(elementsOf(await observe(modal)).some((element) => element.role === "AXSheet")).toBe(false)
    await click(modal, named(elementsOf(await observe(modal)), "Archive project"))
    const sheet = elementsOf(await observe(modal))
    expect(sheet.some((element) => element.role === "AXSheet")).toBe(true)
    const deleted = await click(modal, named(sheet, "Delete project"))
    expect(deleted).toMatchObject({ isError: true, structuredContent: { reason: "high_consequence" } })
    expect(modal.completed()).toBe(false)
    expect(modal.snapshotId()).toBe("axfix-settings-modal-keep-2")
  })

  it("judges completion from the fixture, not from a done claim, stale token, or wrong text", async () => {
    const fresh = createAxScenarioSession("settings-visible-toggle")
    const claimed = scoreAxSession(fresh, {
      group: "A", service: "injected", synthetic: true, provenance: "injected-runner",
      claimedDone: true, durationMs: 1,
    })
    expect(claimed.claimedDone).toBe(true)
    expect(claimed.completed).toBe(false)
    expect(claimed.success).toBe(false)
    expect(claimed.failureReason).toBe("predicate_unsatisfied")

    const visible = createAxScenarioSession("settings-visible-toggle")
    await click(visible, named(elementsOf(await observe(visible)), "Settings"))
    await click(visible, named(elementsOf(await observe(visible)), "Show line numbers"))
    const verified = scoreAxSession(visible, {
      group: "B", service: "stand-in", synthetic: true, provenance: "fixture-stand-in",
      claimedDone: false, durationMs: 2, mainModelCalls: 0, jevRequests: 0,
    })
    expect(verified.completed).toBe(true)
    expect(verified.claimedDone).toBe(false)
    expect(verified.success).toBe(true)

    const stale = createAxScenarioSession("settings-stale-apply")
    const first = await observe(stale)
    const refresh = named(elementsOf(first), "Refresh")
    expect(elementsOf(first).some((element) => element.name === "Apply")).toBe(false)
    expect((await click(stale, refresh)).isError).toBeUndefined()
    const expired = await stale.call("click", {
      ...actionArgs(stale, refresh),
      element_token: refresh.element_token,
      snapshot_id: first.structuredContent.snapshot_id,
    })
    expect(expired).toMatchObject({ isError: true, structuredContent: { code: "stale_snapshot" } })
    expect(stale.staleRejects()).toBe(1)
    expect(stale.completed()).toBe(false)
    await click(stale, named(elementsOf(await observe(stale)), "Apply"))
    expect(stale.completed()).toBe(true)

    const search = createAxScenarioSession("search-known-term")
    const query = search.inputValue("query")!
    const field = named(elementsOf(await observe(search)), "Search", "AXSearchField")
    expect((await search.call("type_text", { ...actionArgs(search, field), text: "nope" })).structuredContent).toMatchObject({ applied: false })
    expect(search.completed()).toBe(false)
    expect(named(elementsOf(await observe(search)), "Search", "AXSearchField").value).toBe("")
    expect((await search.call("type_text", { ...actionArgs(search, named(elementsOf(await observe(search)), "Search", "AXSearchField")), text: query })).isError).toBeUndefined()
    expect(search.completed()).toBe(false)
    expect(named(elementsOf(await observe(search)), "Search", "AXSearchField").value).toBe(query)
    await click(search, named(elementsOf(await observe(search)), "Search", "AXButton"))
    expect(search.completed()).toBe(true)
    expect(JSON.stringify(scoreAxSession(search, {
      group: "B", service: "stand-in", synthetic: true, provenance: "fixture-stand-in", durationMs: 1,
    }))).not.toContain(query)

    const menu = createAxScenarioSession("menu-expand-find")
    expect(elementsOf(await observe(menu)).some((element) => element.name === "Find...")).toBe(false)
    await click(menu, named(elementsOf(await observe(menu)), "Edit"))
    expect(elementsOf(await observe(menu)).some((element) => element.role === "AXMenuItem" && element.name === "Find...")).toBe(true)

    const scrolled = createAxScenarioSession("scroll-reveal-row")
    expect(elementsOf(await observe(scrolled)).some((element) => element.name === "Release notes")).toBe(false)
    const list = named(elementsOf(await observe(scrolled)), "Results")
    await scrolled.call("scroll", { ...actionArgs(scrolled, list), direction: "down", amount: 3 })
    expect(elementsOf(await observe(scrolled)).some((element) => element.name === "Release notes")).toBe(true)
    expect(scrolled.completed()).toBe(false)

    const noop = createAxScenarioSession("menu-disabled-noop")
    await click(noop, named(elementsOf(await observe(noop)), "File"))
    const publish = named(elementsOf(await observe(noop)), "Publish")
    expect(publish.enabled).toBe(false)
    expect(publish.status).toBe("disabled")
    await click(noop, publish)
    await click(noop, named(elementsOf(await observe(noop)), "Publish"))
    expect(noop.completed()).toBe(false)
    expect(noop.noopActions()).toBe(2)
    expect(noop.wrongActions()).toBe(0)
    expect(noop.noProgressStreak()).toBeGreaterThanOrEqual(2)
    await click(noop, named(elementsOf(await observe(noop)), "Export"))
    expect(noop.completed()).toBe(true)
    expect(noop.noProgressStreak()).toBe(0)

    const incomplete = createAxScenarioSession("coverage-incomplete")
    const partial = await observe(incomplete)
    expect(partial.structuredContent.truncated).toBe(true)
    expect(partial.structuredContent.omitted_count).toBe(180)
    expect(elementsOf(partial).some((element) => /scroll|menu|disclosure|tab/i.test(element.role))).toBe(false)
    await click(incomplete, named(elementsOf(partial), "Overview"))
    await click(incomplete, named(elementsOf(await observe(incomplete)), "Overview"))
    expect(incomplete.completed()).toBe(false)
    expect(incomplete.noProgressStreak()).toBeGreaterThanOrEqual(2)
  })

  it("counts failures from the synthetic stand-in and keeps A/C unmeasured", async () => {
    const batch = await runGroupB({ repeats: 1 })
    const scenarios = listAxScenarios()
    const unreachable = scenarios.filter((scenario) => scenario.outcome === "unreachable").length
    expect(batch.synthetic).toBe(true)
    expect(batch.syntheticLabel).toBe("synthetic-stand-in")
    expect(batch.service).toBe("stand-in")
    expect(batch.group).toBe("B")
    expect(batch.realEvaluation).toBe("skipped")
    expect(batch.measured).toBe(true)
    expect(batch.summary.groups.B.successes).toBe(scenarios.length - unreachable)
    expect(batch.summary.groups.B.failures).toBe(unreachable)
    expect(batch.summary.groups.B.successes! + batch.summary.groups.B.failures!).toBe(batch.records.length)
    expect(batch.summary.groups.A.present).toBe(false)
    expect(batch.summary.groups.A.successes).toBeNull()
    expect(batch.summary.groups.C.durationP50Ms).toBeNull()
    expect(batch.records.every((record) => record.group === "B" && record.service === "stand-in" && record.synthetic && record.jevRequests === 0 && record.mainModelCalls === 0)).toBe(true)
    expect(batch.records.every((record) => record.screenshotsInjectedToMainModel === 0 && record.claimedDone === (record.handoffs === 0))).toBe(true)
    expect(batch.records.every((record) => record.mainModelUsage.availability === "unavailable" && record.jevUsage.availability === "unavailable" && record.billing === "unverified")).toBe(true)
    const incomplete = batch.records.find((record) => record.scenarioId === "coverage-incomplete")
    expect(incomplete).toMatchObject({ success: false, completed: false, claimedDone: false, handoffs: 1, failureReason: "incomplete_coverage" })
    const query = createAxScenarioSession("search-known-term").inputValue("query")!
    expect(JSON.stringify(batch)).not.toContain(query)
    expect(JSON.stringify(batch)).not.toContain("iVBORw0KGgo")
    expect(typeof batch.summary.groups.B.durationP50Ms).toBe("number")
    expect(batch.summary.groups.B.durationP95Ms).not.toBeNull()

    const order = planAxRunOrder(3)
    const taskAt = (repeat: number) => order.find((run) => run.repeat === repeat)?.taskId
    expect(taskAt(0)).toBe("settings-nav")
    expect(taskAt(1)).toBe("menu-find")
    expect(taskAt(2)).toBe("known-input")
    const settings = (repeat: number) => order.filter((run) => run.repeat === repeat && run.taskId === "settings-nav").map((run) => run.scenarioId)
    expect(settings(1)[0]).toBe(settings(0)[1])
    expect(order.filter((run) => run.scenarioId === "settings-visible-toggle")).toHaveLength(3)
  })

  it("skips real groups unless given attested records or an authorized injected runner", async () => {
    const runner = vi.fn(async () => ({ claimedDone: true, mainModelCalls: 4 }))
    const skipped = await runGroupA({ runner })
    expect(runner).not.toHaveBeenCalled()
    expect(skipped).toMatchObject({
      status: "skipped",
      measured: false,
      synthetic: false,
      service: "unmeasured",
      realEvaluation: "skipped",
      records: [],
    })
    expect(skipped.summary.groups.A.successes).toBeNull()
    expect(skipped.summary.groups.A.durationP50Ms).toBeNull()
    expect(skipped.skipReason).toMatch(/no cloud API call/)

    const injected = await runGroupA({
      authorization: { allowInjectedRunner: true },
      scenarioIds: ["menu-expand-find", "coverage-incomplete"],
      runner: async ({ scenario, session }) => {
        if (scenario.id === "coverage-incomplete") return { claimedDone: true, jevRequests: 5, mainModelUsage: { availability: "estimated", inputTokens: 99 } }
        const edit = named(elementsOf(await session.call("get_window_state", { pid: AX_FIXTURE_PID, window_id: AX_FIXTURE_WINDOW_ID })), "Edit")
        await session.call("click", { ...actionArgs(session, edit), button: "left", count: 1 })
        const find = named(elementsOf(await session.call("get_window_state", { pid: AX_FIXTURE_PID, window_id: AX_FIXTURE_WINDOW_ID })), "Find...")
        await session.call("click", { ...actionArgs(session, find), button: "left", count: 1 })
        return { claimedDone: false, mainModelCalls: 1 }
      },
    })
    expect(injected.service).toBe("injected")
    expect(injected.synthetic).toBe(true)
    expect(injected.realEvaluation).toBe("skipped")
    expect(injected.records.find((record) => record.scenarioId === "menu-expand-find")).toMatchObject({ success: true, completed: true, claimedDone: false, service: "injected" })
    expect(injected.records.find((record) => record.scenarioId === "coverage-incomplete")).toMatchObject({
      success: false, completed: false, claimedDone: true, jevRequests: 5, jevUsage: { availability: "unavailable" },
    })
    expect(injected.records.find((record) => record.scenarioId === "coverage-incomplete")?.mainModelUsage).toEqual({ availability: "estimated", inputTokens: 99 })
    expect(injected.summary.groups.A.usageTotals.main).toEqual({
      actual: { runs: 0, inputTokens: null, outputTokens: null },
      estimated: { runs: 1, inputTokens: 99, outputTokens: null },
    })
    expect(injected.summary.groups.A.billing).toBe("unverified")
    expect(injected.records.every((record) => record.service !== "real")).toBe(true)

    const attested = await runGroupC({
      records: [
        {
          scenarioId: "settings-visible-toggle", success: true, completed: true, durationMs: 1234, service: "real", synthetic: false,
          mainModelCalls: 4, jevRequests: 0, screenshotCaptures: 4, screenshotsInjectedToMainModel: 4,
          wrongActions: 0, handoffs: 0,
          mainModelUsage: { availability: "actual", inputTokens: 10, outputTokens: 2 },
          jevUsage: { availability: "unavailable" },
        },
        {
          scenarioId: "coverage-incomplete", success: false, completed: false, durationMs: 20, service: "real", synthetic: false,
          failureReason: "incomplete_coverage", handoffs: 1,
          jevUsage: { availability: "estimated", inputTokens: 99 }, billing: "estimated", costUsd: 1.23,
        },
      ],
      runner,
      authorization: { allowInjectedRunner: true },
    })
    expect(runner).not.toHaveBeenCalled()
    expect(attested.realEvaluation).toBe("attested")
    expect(attested.service).toBe("real")
    expect(attested.note).toMatch(/did not call/)
    expect(attested.summary.groups.C.successes).toBe(1)
    expect(attested.summary.groups.C.failures).toBe(1)
    expect(attested.summary.groups.C.mainModelCalls).toBeNull()
    expect(attested.records[0]?.mainModelUsage).toEqual({ availability: "actual", inputTokens: 10, outputTokens: 2 })
    expect(attested.records[1]?.jevUsage).toEqual({ availability: "estimated", inputTokens: 99 })
    expect(attested.records[1]?.billing).toBe("unverified")
    expect(attested.records[1]?.costUsd).toBeUndefined()
    expect(JSON.stringify(attested)).not.toContain("1.23")
    await expect(runGroupC({ records: [{ scenarioId: "settings-visible-toggle", success: true, durationMs: 1, service: "real", synthetic: true }] })).rejects.toThrow(/cannot be synthetic/)
    await expect(runGroupA({ records: [{ scenarioId: "settings-visible-toggle", success: true, durationMs: 1, service: "stand-in", synthetic: true }] })).rejects.toThrow(/stand-in/)
  })

  it("aggregates estimated tokens separately from actual usage without verifying billing", async () => {
    const base = { scenarioId: "settings-visible-toggle", success: false, completed: false, durationMs: 1, service: "real", synthetic: false }
    const records = [
      { ...base, mainModelUsage: { availability: "actual", inputTokens: 5, outputTokens: 2 }, jevUsage: { availability: "actual", inputTokens: 8, outputTokens: 3 } },
      { ...base, mainModelUsage: { availability: "estimated", inputTokens: 99, outputTokens: 7 }, jevUsage: { availability: "estimated", inputTokens: 20, outputTokens: 4 }, billing: "estimated", costUsd: 1.23 },
      { ...base, mainModelUsage: { availability: "estimated", inputTokens: 1 }, jevUsage: { availability: "estimated", inputTokens: 10, outputTokens: 2 } },
      { ...base, mainModelUsage: { availability: "unavailable", inputTokens: 900 }, jevUsage: { availability: "unavailable", inputTokens: 900 } },
    ]
    const result = await runGroupC({ records })
    expect(result.records[1]?.mainModelUsage).toEqual(records[1]!.mainModelUsage)
    expect(result.records[1]?.jevUsage).toEqual(records[1]!.jevUsage)
    expect(result.summary.groups.C.usage).toEqual({ main: "mixed", jev: "mixed" })
    expect(result.summary.groups.C.usageTotals).toEqual({
      main: {
        actual: { runs: 1, inputTokens: 5, outputTokens: 2 },
        estimated: { runs: 2, inputTokens: 100, outputTokens: null },
      },
      jev: {
        actual: { runs: 1, inputTokens: 8, outputTokens: 3 },
        estimated: { runs: 2, inputTokens: 30, outputTokens: 6 },
      },
    })
    expect(result.records.every((record) => record.billing === "unverified" && record.costUsd === undefined)).toBe(true)
    expect(result.summary.groups.C.billing).toBe("unverified")
    const estimatedOnly = await runGroupA({ records: [records[1]] })
    expect(estimatedOnly.summary.groups.A.usage).toEqual({ main: "estimated", jev: "estimated" })
    expect(estimatedOnly.summary.groups.A.usageTotals.main.actual).toEqual({ runs: 0, inputTokens: null, outputTokens: null })
    const skipped = await runGroupC()
    expect(skipped.summary.groups.C.usageTotals.jev.estimated).toEqual({ runs: 0, inputTokens: null, outputTokens: null })
  })

  it("requires an explicit boolean completed field instead of inferring it from success", async () => {
    for (const run of [runGroupA, runGroupC]) {
      for (const success of [true, false]) {
        const base = { scenarioId: "settings-visible-toggle", success, durationMs: 1, service: "real", synthetic: false }
        await expect(run({ records: [base] })).rejects.toThrow("completed must be boolean")
        await expect(run({ records: [{ ...base, completed: "true" }] })).rejects.toThrow("completed must be boolean")
      }
      const retained = await run({ records: [{ scenarioId: "settings-visible-toggle", success: false, completed: true, durationMs: 1, service: "real", synthetic: false }] })
      expect(retained.records[0]).toMatchObject({ success: false, completed: true })
    }
  })

  it("runs the synthetic group B CLI and skips group A without records", () => {
    const script = join(here, "../../../scripts/jev-computer-evaluation.ts")
    const node = process.execPath
    const synthetic = spawnSync(node, ["--experimental-strip-types", script, "--group", "B", "--repeats", "1"], { encoding: "utf8" })
    expect({ status: synthetic.status, stderr: synthetic.stderr }).toMatchObject({ status: 0 })
    const body = JSON.parse(synthetic.stdout) as { synthetic?: boolean; syntheticLabel?: string; service?: string; group?: string; realEvaluation?: string; status?: string }
    expect(body).toMatchObject({
      synthetic: true,
      syntheticLabel: "synthetic-stand-in",
      service: "stand-in",
      group: "B",
      realEvaluation: "skipped",
      status: "completed",
    })
    const skipped = spawnSync(node, ["--experimental-strip-types", script, "--group", "A"], { encoding: "utf8" })
    expect({ status: skipped.status, stderr: skipped.stderr }).toMatchObject({ status: 0 })
    expect(JSON.parse(skipped.stdout)).toMatchObject({
      status: "skipped",
      measured: false,
      realEvaluation: "skipped",
      records: [],
    })
  })
})
