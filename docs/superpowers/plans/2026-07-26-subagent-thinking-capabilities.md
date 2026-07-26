# Subagent Thinking Capability Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Subagent「思考强度」picker show only the thinking levels each selected model actually supports, sourced exclusively from the model-list capability metadata (`reasoning` / `thinkingLevelMap`), and auto-reset an incompatible persisted level to「默认」when the user switches models or when settings reload.

**Architecture:** A new pure Swift module `ThinkingCapability` maps pi model metadata to an ordered set of allowed thinking-level tags. The capability metadata (`reasoning: Bool`, `thinkingLevelMap`) already exists on pi's `Model<Api>` objects and is already returned by pi's `get_available_models` RPC; we surface it through the two model-list parse paths (`PiAuthHelper.listModels()` and the in-process `get_available_models` handler in `ChatSession`) onto `ModelInfo`. `SubagentModelRow` renders the picker from that metadata; `setSubagentModelOverride` and `reload()` reuse the same pure resolver to decide resets. The Node spawn extension `PiExt/subagent/index.ts` is NOT modified — its existing `PI_THINKING_LEVELS` suffix-strip clamp and `--thinking` passthrough stay as the defensive spawn layer, exactly as the approved product decision requires.

**Tech Stack:** Swift 5.9 / SwiftPM (`PipiUI` target, `PipiUITests` XCTest target), SwiftUI (`SettingsSheet` / `SubagentModelRow`), Node/TypeScript bridge (`pi-auth-helper.mjs`), pi runtime `ModelRuntime.getAvailable()` returning `@earendil-works/pi-ai` `Model<Api>[]`.

## Global Constraints

Carry these verbatim into every task; every task implicitly includes them.

- **Capability source is metadata ONLY.** The sole source of per-model thinking capability is the model-list metadata fields `reasoning` (`Model.reasoning: boolean`) and `thinkingLevelMap` (`Model.thinkingLevelMap: Partial<Record<"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max", string | null>>`). Per pi semantics: a missing key uses provider defaults; a `null` value marks a level explicitly unsupported.
- **No catalog JSON.** Do NOT create `Sources/PipiUI/Resources/thinking-capabilities.json`. Do NOT introduce a `ThinkingCapabilityCatalog`, `ModelPricing`-style bundled map, or any curated/derived capability list. (This intentionally supersedes the static-catalog approach described in the approved spec §5.3–5.5 and §14 decision 1 — see「Spec Alignment」below and Task 6.)
- **No settings-page RPC for capability.** Do NOT call `get_available_thinking_levels` (the main-session `ChatSession.refreshThinkingLevels` RPC) from the Subagent settings UI, and do NOT add any new RPC. That RPC reflects only the single current session model and cannot enumerate every candidate model.
- **Visibility rules.** 非推理模型 (`reasoning == false`) shows ONLY「默认（由模型决定）」as a read-only line. Standard reasoning (`reasoning == true`) shows 默认 / 关闭思考 / 极低 / 低 / 中 / 高. `xhigh` / `max` are shown ONLY when `thinkingLevelMap` contains that key mapped to a non-null string. When capability metadata is unavailable (model id not present in the in-memory list), fall back to the standard 6-level set so the user is never silently locked out.
- **Reset semantics.** When switching models or on settings reload, a persisted non-default thinking level that the selected model does not allow is reset to「默认」(persisted as `nil`). Reset to default is idempotent. The「跟随主 Agent」path (`selection == ""`) keeps existing behavior: it clears the whole override and never resets.
- **Spawn clamp preserved.** `PiExt/subagent/index.ts` is unchanged: `PI_THINKING_LEVELS` (line 335), `stripModelThinkingSuffix` (lines 337–342), `resolveAgentThinking` (lines 416–420), and spawn `args.push("--thinking", resolvedThinking)` (line 1464) all stay. UI is the authoritative filter; spawn keeps its defensive clamp.
- **Schema + copy unchanged.** `SubagentModelSettings.Override` schema is unchanged; `defaultThinkingSentinel == ""` and `followMainSentinel == ""`. Tags and Chinese labels are unchanged: `""`→默认（由模型决定）, `off`→关闭思考, `minimal`→极低, `low`→低, `medium`→中, `high`→高, `xhigh`→极高, `max`→最大.
- **Worker verification limits (binding).** Workers verify ONLY with `swift build` and `swift test` (optionally `swift run PipiUITestRunner` where noted). Workers MUST NOT run `./make-app.sh`, `./scripts/build-app.sh`, or any command that produces `build/PipiUI.app`. Producing the runnable app is reserved for the primary checkout release step, not for this feature work.
- **Commit hygiene.** Each task ends with one focused commit using the listed message. Do not commit unrelated working-tree changes; stage only the files named in that task.

## Spec Alignment — the approved design spec MUST be updated

The approved design spec at `docs/superpowers/specs/2026-07-26-subagent-thinking-capabilities-design.md` currently specifies a **static curated capability map** (`ThinkingCapabilityCatalog` + a bundled `Resources/thinking-capabilities.json`) as the capability source (spec §5.3, §5.4, §5.5, §7 file table, §14 decision 1). This plan adopts a **different, metadata-based** source instead: the `reasoning` / `thinkingLevelMap` fields already present on every pi model object, surfaced through the existing model-list pipeline.

That is a deliberate, approved change of data source, NOT a contradiction to leave unresolved. To keep the spec honest, Task 6 rewrites the affected spec sections so the spec and this plan agree. Until Task 6 lands, the spec's catalog language is stale; implementers follow THIS plan, not the spec's catalog sections.

The metadata approach is strictly better than the spec's catalog here because the capability data is already authoritative, already per-model, already maintained upstream by pi/provider definitions, and already returned by the in-process model enumeration — so a second curated copy in PipiUI would duplicate and inevitably drift.

## File Structure

| File | Type | Responsibility |
|------|------|----------------|
| `Sources/PipiUI/ThinkingCapability.swift` | **Create** | Pure resolver: `allowedLevels(reasoning:thinkingLevelMap:)`, `allows(_:reasoning:thinkingLevelMap:)`, `resolvedThinking(persisted:reasoning:thinkingLevelMap:)`, `parseThinkingLevelMap(_:)`. No I/O, no catalog, no RPC. |
| `Sources/PipiUI/ChatSession.swift` | **Modify** | Add `reasoning` + `thinkingLevelMap` stored props to `ModelInfo` (defaults keep all existing call sites compiling). Parse both fields in the `get_available_models` handler (around lines 818–821). |
| `Sources/PipiUI/PiAuthHelper.swift` | **Modify** | Parse `reasoning` + `thinkingLevelMap` from the helper JSON in `listModels()` (around lines 112–123). |
| `Sources/PipiUI/Resources/pi-auth-helper.mjs` | **Modify** | Emit `reasoning` and `thinkingLevelMap` from `runtime.getAvailable()` in `listModels()` (around lines 100–110). |
| `Sources/PipiUI/Views/SettingsSheet.swift` | **Modify** | (a) `SubagentModelRow` (around lines 1234–1320): dynamic picker from `ThinkingCapability.allowedLevels`; 非推理模型 → read-only line. (b) `setSubagentModelOverride` (around lines 908–919): reset-on-switch. (c) `reload()` (around lines 1135–1190): idempotent normalization + a `capability(forModelId:)` helper. |
| `Sources/PipiUI/SubagentModelSettings.swift` | **No change** | `Override`, `setOverride`, sentinels reused as-is. |
| `Sources/PipiUI/PiExt/subagent/index.ts` | **No change** | Spawn clamp preserved (regression-guarded by an existing test). |
| `Tests/PipiUITests/ThinkingCapabilityTests.swift` | **Create** | Pure unit tests for the resolver and map parser. |
| `Tests/PipiUITests/SubagentModelSettingsTests.swift` | **Modify** | Add source-grep guard tests for metadata surfacing, dynamic picker, reset, and normalization. |
| `docs/superpowers/specs/2026-07-26-subagent-thinking-capabilities-design.md` | **Modify (Task 6)** | Replace static-catalog design with metadata-based design so spec and plan agree. |

---

### Task 1: Pure capability resolver `ThinkingCapability` (TDD)

**Files:**
- Create: `Sources/PipiUI/ThinkingCapability.swift`
- Test: `Tests/PipiUITests/ThinkingCapabilityTests.swift`

**Interfaces:**
- Consumes: nothing (pure logic; `[String: Any]` is Foundation).
- Produces: `ThinkingCapability.allowedLevels(reasoning: Bool?, thinkingLevelMap: [String: String?]?) -> [String]`, `ThinkingCapability.allows(_:reasoning:thinkingLevelMap:) -> Bool`, `ThinkingCapability.resolvedThinking(persisted:reasoning:thinkingLevelMap:) -> String?`, `ThinkingCapability.parseThinkingLevelMap(_ raw: [String: Any]?) -> [String: String?]?`. Later tasks call exactly these signatures.

- [ ] **Step 1: Write the failing tests**

Create `Tests/PipiUITests/ThinkingCapabilityTests.swift`:

```swift
import XCTest
@testable import PipiUI

final class ThinkingCapabilityTests: XCTestCase {
    func testNonReasoningShowsOnlyDefault() {
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(reasoning: false, thinkingLevelMap: nil),
            [""]
        )
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(reasoning: false, thinkingLevelMap: ["xhigh": "e"]),
            [""]
        )
    }

    func testReasoningWithNoMapIsStandardSix() {
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(reasoning: true, thinkingLevelMap: nil),
            ["", "off", "minimal", "low", "medium", "high"]
        )
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(reasoning: true, thinkingLevelMap: [:]),
            ["", "off", "minimal", "low", "medium", "high"]
        )
    }

    func testXhighMaxShownOnlyWhenMappedToNonNull() {
        // xhigh present with a value, max absent -> +xhigh only
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(reasoning: true, thinkingLevelMap: ["xhigh": "effort_high"]),
            ["", "off", "minimal", "low", "medium", "high", "xhigh"]
        )
        // both present with values -> full 8
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(reasoning: true, thinkingLevelMap: ["xhigh": "a", "max": "b"]),
            ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"]
        )
        // xhigh mapped to null (explicitly unsupported) -> NOT shown
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(reasoning: true, thinkingLevelMap: ["xhigh": .some(nil), "max": "b"]),
            ["", "off", "minimal", "low", "medium", "high", "max"]
        )
    }

    func testUnknownMetadataFallsBackToStandard() {
        // reasoning == nil (model not in list) -> standard 6, never lock out a level
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(reasoning: nil, thinkingLevelMap: nil),
            ["", "off", "minimal", "low", "medium", "high"]
        )
    }

    func testAllowsDefaultAlwaysTrue() {
        XCTAssertTrue(ThinkingCapability.allows("", reasoning: false, thinkingLevelMap: nil))
        XCTAssertTrue(ThinkingCapability.allows("", reasoning: true, thinkingLevelMap: nil))
        XCTAssertTrue(ThinkingCapability.allows("", reasoning: nil, thinkingLevelMap: nil))
    }

    func testAllowsExtendedLevelRespectsMap() {
        XCTAssertTrue(ThinkingCapability.allows("xhigh", reasoning: true, thinkingLevelMap: ["xhigh": "a"]))
        XCTAssertFalse(ThinkingCapability.allows("xhigh", reasoning: true, thinkingLevelMap: ["xhigh": .some(nil)]))
        XCTAssertFalse(ThinkingCapability.allows("xhigh", reasoning: true, thinkingLevelMap: nil))
        XCTAssertFalse(ThinkingCapability.allows("off", reasoning: false, thinkingLevelMap: nil))
    }

    func testResolvedThinkingResetsIncompatible() {
        // standard model, persisted xhigh (not allowed) -> reset to nil
        XCTAssertNil(ThinkingCapability.resolvedThinking(
            persisted: "xhigh", reasoning: true, thinkingLevelMap: nil))
        // extended model supports xhigh -> kept
        XCTAssertEqual(ThinkingCapability.resolvedThinking(
            persisted: "xhigh", reasoning: true, thinkingLevelMap: ["xhigh": "a"]), "xhigh")
        // non-reasoning model, persisted high -> reset to nil
        XCTAssertNil(ThinkingCapability.resolvedThinking(
            persisted: "high", reasoning: false, thinkingLevelMap: nil))
    }

    func testResolvedThinkingKeepsCompatibleAndDefault() {
        XCTAssertEqual(ThinkingCapability.resolvedThinking(
            persisted: "high", reasoning: true, thinkingLevelMap: nil), "high")
        XCTAssertNil(ThinkingCapability.resolvedThinking(
            persisted: "", reasoning: true, thinkingLevelMap: nil))
        XCTAssertNil(ThinkingCapability.resolvedThinking(
            persisted: nil, reasoning: true, thinkingLevelMap: nil))
    }

    func testResolvedThinkingKeepsValueWhenMetadataUnknown() {
        // reasoning == nil -> never spuriously reset, keep the persisted value
        XCTAssertEqual(ThinkingCapability.resolvedThinking(
            persisted: "xhigh", reasoning: nil, thinkingLevelMap: nil), "xhigh")
    }

    func testParseThinkingLevelMapDistinguishesNullAbsentAndNonString() {
        XCTAssertNil(ThinkingCapability.parseThinkingLevelMap(nil))
        XCTAssertNil(ThinkingCapability.parseThinkingLevelMap([:]))
        let map = ThinkingCapability.parseThinkingLevelMap([
            "xhigh": "effort_high",
            "off": NSNull(),
            "low": 42, // non-string dropped
        ])
        XCTAssertEqual(map?["xhigh"], .some("effort_high"))
        XCTAssertEqual(map?["off"], .some(nil))
        XCTAssertNil(map?["low"])
        XCTAssertNil(map?["max"]) // absent -> nil (provider default)
    }

    func testParseThinkingLevelMapEmptyAfterDroppingNonStringsReturnsNil() {
        XCTAssertNil(ThinkingCapability.parseThinkingLevelMap(["low": 42]))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail (type does not exist yet)**

Run: `swift test --filter ThinkingCapabilityTests 2>&1 | tail -20`
Expected: FAIL / compile error — `cannot find 'ThinkingCapability' in scope` (the new module does not exist yet). Exit non-zero.

- [ ] **Step 3: Implement the resolver**

Create `Sources/PipiUI/ThinkingCapability.swift`:

```swift
import Foundation

/// Pure resolver mapping pi model-list capability metadata to the ordered thinking-level tags
/// shown in the Subagent settings picker.
///
/// **Sole capability source:** the model-list metadata fields `reasoning` (`Model.reasoning`)
/// and `thinkingLevelMap` (`Model.thinkingLevelMap`) returned by `runtime.getAvailable()` and
/// surfaced through `PiAuthHelper.listModels()` / the `get_available_models` RPC. This module
/// introduces NO bundled catalog JSON and NO settings-page RPC for capability.
///
/// Rules (approved product decisions):
/// - `reasoning == false`  -> non-reasoning: only the default sentinel `""`.
/// - `reasoning == true`   -> standard set `["", "off", "minimal", "low", "medium", "high"]`,
///   plus `"xhigh"` / `"max"` only when `thinkingLevelMap` maps that key to a non-null string
///   (pi semantics: a missing key uses provider defaults; `null` marks a level unsupported).
/// - `reasoning == nil`    -> metadata unavailable (model id not in list): standard fallback,
///   the safe default that never silently locks a level away.
enum ThinkingCapability {
    /// Standard reasoning set, always shown for any reasoning-capable model.
    static let standardTags: [String] = ["", "off", "minimal", "low", "medium", "high"]

    /// 非推理模型 set: only the model default.
    static let nonReasoningTags: [String] = [""]

    /// Allowed ordered tags for a model with the given metadata.
    static func allowedLevels(
        reasoning: Bool?,
        thinkingLevelMap: [String: String?]?
    ) -> [String] {
        switch reasoning {
        case nil:
            return standardTags
        case .some(false):
            return nonReasoningTags
        case .some(true):
            var levels = standardTags
            if let value = thinkingLevelMap?["xhigh"], value != nil { levels.append("xhigh") }
            if let value = thinkingLevelMap?["max"], value != nil { levels.append("max") }
            return levels
        }
    }

    /// Whether `level` is allowed for the model. The default sentinel `""` is always allowed.
    static func allows(
        _ level: String,
        reasoning: Bool?,
        thinkingLevelMap: [String: String?]?
    ) -> Bool {
        allowedLevels(reasoning: reasoning, thinkingLevelMap: thinkingLevelMap).contains(level)
    }

    /// Decide the thinking value to persist when switching to — or normalizing for — a model
    /// with the given metadata. Returns `nil` to mean「reset to model default」.
    ///
    /// - Empty / default persisted thinking (`nil` or `""`) -> `nil` (unchanged default).
    /// - Metadata unknown (`reasoning == nil`) -> the persisted value unchanged (no spurious reset).
    /// - Persisted value allowed by the model -> unchanged.
    /// - Persisted value NOT allowed -> `nil` (reset to default).
    static func resolvedThinking(
        persisted oldThinking: String?,
        reasoning: Bool?,
        thinkingLevelMap: [String: String?]?
    ) -> String? {
        let trimmed = oldThinking?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty { return nil }
        guard let reasoning else { return oldThinking }
        return allows(trimmed, reasoning: reasoning, thinkingLevelMap: thinkingLevelMap)
            ? oldThinking
            : nil
    }

    /// Convert a raw JSON-parsed thinking level map (`{level: string|null}`) — as produced by
    /// `JSONSerialization` (`[String: Any]`) or by the `J` helper's `.dict` — into the
    /// `[String: String?]` representation. `NSNull` / null -> explicit `.some(nil)` (unsupported);
    /// non-string values are dropped; an empty result returns `nil`.
    static func parseThinkingLevelMap(_ raw: [String: Any]?) -> [String: String?]? {
        guard let raw, !raw.isEmpty else { return nil }
        var converted: [String: String?] = [:]
        for (key, value) in raw {
            if value is NSNull {
                converted[key] = .some(nil)
            } else if let string = value as? String {
                converted[key] = string
            }
        }
        return converted.isEmpty ? nil : converted
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --filter ThinkingCapabilityTests 2>&1 | tail -20`
Expected: PASS — `Test Suite 'ThinkingCapabilityTests' passed`, all 11 test methods green, exit 0.

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/ThinkingCapability.swift Tests/PipiUITests/ThinkingCapabilityTests.swift
git commit -m "feat(subagent): add ThinkingCapability metadata resolver"
```

---

### Task 2: Surface `reasoning` / `thinkingLevelMap` metadata onto `ModelInfo`

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift` (`ModelInfo` struct near line 5; `get_available_models` handler near lines 818–821)
- Modify: `Sources/PipiUI/PiAuthHelper.swift` (`listModels()` near lines 112–123)
- Modify: `Sources/PipiUI/Resources/pi-auth-helper.mjs` (`listModels()` near lines 100–110)
- Test: `Tests/PipiUITests/SubagentModelSettingsTests.swift` (append guard tests)

**Interfaces:**
- Consumes: `ThinkingCapability.parseThinkingLevelMap(_:)` from Task 1.
- Produces: `ModelInfo.reasoning: Bool` (default `false`) and `ModelInfo.thinkingLevelMap: [String: String?]?` (default `nil`). Both are defaulted stored properties, so every existing `ModelInfo(provider:modelId:name:contextWindow:)` call site continues to compile unchanged.

- [ ] **Step 1: Write the failing guard tests**

Append to `Tests/PipiUITests/SubagentModelSettingsTests.swift`, inside the `SubagentModelSettingsTests` class:

```swift
func testHelperEmitsCapabilityMetadata() throws {
    let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()      // PipiUITests
        .deletingLastPathComponent()      // Tests
        .deletingLastPathComponent()      // repository root
    let source = try String(
        contentsOf: root.appendingPathComponent("Sources/PipiUI/Resources/pi-auth-helper.mjs"),
        encoding: .utf8
    )
    // listModels() must forward pi Model.reasoning / Model.thinkingLevelMap to the app.
    XCTAssertTrue(source.contains("reasoning: m.reasoning ?? false"))
    XCTAssertTrue(source.contains("thinkingLevelMap: m.thinkingLevelMap"))
}

func testPiAuthHelperParsesCapabilityMetadata() throws {
    let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let source = try String(
        contentsOf: root.appendingPathComponent("Sources/PipiUI/PiAuthHelper.swift"),
        encoding: .utf8
    )
    XCTAssertTrue(source.contains("ThinkingCapability.parseThinkingLevelMap"))
    XCTAssertTrue(source.contains("reasoning:"))
}

func testModelInfoCarriesCapabilityFields() throws {
    // Defaulted stored props: 4-arg initializer still works and yields unknown capability.
    let m = ModelInfo(provider: "xai", modelId: "grok-4", name: "Grok 4", contextWindow: nil)
    XCTAssertEqual(m.reasoning, false)
    XCTAssertNil(m.thinkingLevelMap)
    // Explicit metadata flows through.
    let reasoning = ModelInfo(
        provider: "xai", modelId: "grok-4.5", name: "Grok 4.5", contextWindow: 256000,
        reasoning: true, thinkingLevelMap: ["xhigh": "effort_high"]
    )
    XCTAssertTrue(reasoning.reasoning)
    XCTAssertEqual(reasoning.thinkingLevelMap?["xhigh"], .some("effort_high"))
}

func testGetAvailableModelsParsesCapability() throws {
    let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let source = try String(
        contentsOf: root.appendingPathComponent("Sources/PipiUI/ChatSession.swift"),
        encoding: .utf8
    )
    // The get_available_models handler must populate reasoning + thinkingLevelMap from the RPC.
    XCTAssertTrue(source.contains("reasoning: m[\"reasoning\"].bool ?? false"))
    XCTAssertTrue(source.contains("thinkingLevelMap: ThinkingCapability.parseThinkingLevelMap(m[\"thinkingLevelMap\"].dict)"))
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --filter SubagentModelSettingsTests 2>&1 | tail -25`
Expected: FAIL — the four new guard tests fail (source strings absent; `ModelInfo` has no `reasoning`/`thinkingLevelMap` init parameters). Exit non-zero.

- [ ] **Step 3: Add the capability fields to `ModelInfo`**

In `Sources/PipiUI/ChatSession.swift`, edit the `ModelInfo` struct (currently lines 5–11) to add two defaulted stored properties. The result:

```swift
struct ModelInfo: Identifiable, Hashable {
    let provider: String
    let modelId: String
    let name: String
    let contextWindow: Int?
    /// pi `Model.reasoning`: whether the model can reason at all. Surfaced from the
    /// model-list metadata by `PiAuthHelper.listModels()` / the `get_available_models` RPC.
    var reasoning: Bool = false
    /// pi `Model.thinkingLevelMap`: maps a thinking level to a provider value, or `nil`
    /// (NSNull) to mark the level explicitly unsupported. Absent keys use provider defaults.
    var thinkingLevelMap: [String: String?]? = nil
    var id: String { provider + "/" + modelId }
```

Leave the existing computed properties (`isGrokProvider`, `isRelayProvider`, `quotaProvider`, …) untouched.

- [ ] **Step 4: Parse the metadata in the `get_available_models` handler**

In `Sources/PipiUI/ChatSession.swift`, replace the `availableModels` mapping inside `loadInitialState()` (currently lines 818–821) with:

```swift
self?.availableModels = resp["data"]["models"].array.compactMap { m in
    guard let pid = m["provider"].string, let mid = m["id"].string else { return nil }
    return ModelInfo(
        provider: pid,
        modelId: mid,
        name: m["name"].string ?? mid,
        contextWindow: m["contextWindow"].int,
        reasoning: m["reasoning"].bool ?? false,
        thinkingLevelMap: ThinkingCapability.parseThinkingLevelMap(m["thinkingLevelMap"].dict)
    )
}
```

- [ ] **Step 5: Emit the metadata from the Node helper**

In `Sources/PipiUI/Resources/pi-auth-helper.mjs`, replace the body of `listModels()` (currently lines 101–110) with:

```javascript
async function listModels() {
  await withRuntime(async (runtime) => {
    const models = await runtime.getAvailable();
    emit({
      ok: true,
      models: models.map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name ?? m.id,
        contextWindow: m.contextWindow ?? null,
        reasoning: m.reasoning ?? false,
        thinkingLevelMap: m.thinkingLevelMap,
      })),
    });
  });
}
```

- [ ] **Step 6: Parse the metadata in `PiAuthHelper.listModels()`**

In `Sources/PipiUI/PiAuthHelper.swift`, replace the `return models.compactMap { … }` block (currently lines 116–123) with:

```swift
return models.compactMap { row in
    guard let provider = row["provider"] as? String, let id = row["id"] as? String else { return nil }
    let name = (row["name"] as? String) ?? id
    let ctx = row["contextWindow"] as? Int
    let reasoning = (row["reasoning"] as? Bool) ?? false
    let thinkingLevelMap = ThinkingCapability.parseThinkingLevelMap(
        row["thinkingLevelMap"] as? [String: Any]
    )
    return ModelInfo(
        provider: provider,
        modelId: id,
        name: name,
        contextWindow: ctx,
        reasoning: reasoning,
        thinkingLevelMap: thinkingLevelMap
    )
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `swift test --filter SubagentModelSettingsTests --filter ThinkingCapabilityTests 2>&1 | tail -25`
Expected: PASS — all four new guard tests pass; Task 1 tests still green. Exit 0.

- [ ] **Step 8: Commit**

```bash
git add Sources/PipiUI/ChatSession.swift Sources/PipiUI/PiAuthHelper.swift Sources/PipiUI/Resources/pi-auth-helper.mjs Tests/PipiUITests/SubagentModelSettingsTests.swift
git commit -m "feat(subagent): surface reasoning/thinkingLevelMap onto ModelInfo"
```

---

### Task 3: Dynamic thinking picker in `SubagentModelRow`

**Files:**
- Modify: `Sources/PipiUI/Views/SettingsSheet.swift` (`SubagentModelRow`, currently lines 1234–1320)
- Test: `Tests/PipiUITests/SubagentModelSettingsTests.swift` (append guard test)

**Interfaces:**
- Consumes: `ModelInfo.reasoning` / `ModelInfo.thinkingLevelMap` (Task 2) and `ThinkingCapability.allowedLevels` (Task 1).
- Produces: a picker whose option list is computed from the selected model's metadata; 非推理模型 renders a read-only line instead of a picker.

- [ ] **Step 1: Write the failing guard test**

Append to the `SubagentModelSettingsTests` class in `Tests/PipiUITests/SubagentModelSettingsTests.swift`:

```swift
func testSubagentRowRendersDynamicPickerFromMetadata() throws {
    let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let source = try String(
        contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/SettingsSheet.swift"),
        encoding: .utf8
    )
    // Picker options come from the resolver driven by the selected model's metadata.
    XCTAssertTrue(source.contains("ThinkingCapability.allowedLevels("))
    XCTAssertTrue(source.contains("ForEach(allowedThinkingTags, id: \\.self)"))
    // 非推理模型 is rendered as a read-only explanation, not a picker.
    XCTAssertTrue(source.contains("该模型为非推理模型，思考强度由模型决定。"))
    // Existing follow-main disable behavior is preserved.
    XCTAssertTrue(source.contains(".disabled(selection.isEmpty)"))
    // Tag -> Chinese label mapping is intact and unchanged.
    XCTAssertTrue(source.contains("\"\" : return \"默认（由模型决定）\""))
    XCTAssertTrue(source.contains("\"off\" : return \"关闭思考\""))
    XCTAssertTrue(source.contains("\"xhigh\" : return \"极高\""))
    XCTAssertTrue(source.contains("\"max\" : return \"最大\""))
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `swift test --filter SubagentModelSettingsTests/testSubagentRowRendersDynamicPickerFromMetadata 2>&1 | tail -15`
Expected: FAIL — the source does not yet reference `ThinkingCapability.allowedLevels` or the read-only non-reasoning line. Exit non-zero.

- [ ] **Step 3: Rewrite the thinking-level part of `SubagentModelRow.body`**

In `Sources/PipiUI/Views/SettingsSheet.swift`, inside `private struct SubagentModelRow` (lines ~1234–1320), first add these computed helpers immediately after the stored properties (before `static func ==`):

```swift
/// Capability of the currently selected model. `(reasoning: nil, …)` when the model id is
/// not present in `pickerModels` — the resolver then falls back to the standard 6-level set.
private var selectedCapability: (reasoning: Bool?, thinkingLevelMap: [String: String?]?) {
    guard let model = pickerModels.first(where: { $0.id == selection }) else { return (nil, nil) }
    return (model.reasoning, model.thinkingLevelMap)
}

private var isNonReasoning: Bool { selectedCapability.reasoning == .some(false) }

private var allowedThinkingTags: [String] {
    ThinkingCapability.allowedLevels(
        reasoning: selectedCapability.reasoning,
        thinkingLevelMap: selectedCapability.thinkingLevelMap
    )
}

private func thinkingLabel(for tag: String) -> String {
    switch tag {
    case "": return "默认（由模型决定）"
    case "off": return "关闭思考"
    case "minimal": return "极低"
    case "low": return "低"
    case "medium": return "中"
    case "high": return "高"
    case "xhigh": return "极高"
    case "max": return "最大"
    default: return tag
    }
}
```

Then replace the existing hardcoded thinking `Picker` block (the `Picker("思考强度", …)` with eight `Text(...).tag(...)` entries and `.disabled(selection.isEmpty)`) with:

```swift
if isNonReasoning {
    Text("该模型为非推理模型，思考强度由模型决定。")
        .font(.caption)
        .foregroundStyle(.secondary)
} else {
    Picker(
        "思考强度",
        selection: Binding(get: { thinking }, set: { onSelectThinking($0) })
    ) {
        ForEach(allowedThinkingTags, id: \.self) { tag in
            Text(thinkingLabel(for: tag)).tag(tag)
        }
    }
    .disabled(selection.isEmpty)
    .help(selection.isEmpty ? "跟随主 Agent 时仅跟随当前底栏模型" : "仅对这个 Subagent 的新进程生效")
}
```

Do not change the model `Picker` above it, the `selectionLogo`, the `agent`/`description` text, or the `static func ==` (the new state is derived from existing fields, so `Equatable` stays correct).

- [ ] **Step 4: Run the test to verify it passes**

Run: `swift test --filter SubagentModelSettingsTests/testSubagentRowRendersDynamicPickerFromMetadata 2>&1 | tail -15`
Expected: PASS — exit 0.

- [ ] **Step 5: Manual QA note (optional, not a gate)**

If a worker can run the app locally for a visual check: select a 非推理模型 (e.g. an id containing `embedding`) → row shows the read-only line; select a reasoning model with no `xhigh` mapping → picker shows 6 items; select a model whose `thinkingLevelMap` includes `xhigh` → picker shows 7–8 items. This is informational; the binding gate is `swift test`.

- [ ] **Step 6: Commit**

```bash
git add Sources/PipiUI/Views/SettingsSheet.swift Tests/PipiUITests/SubagentModelSettingsTests.swift
git commit -m "feat(subagent): filter thinking picker by model capability metadata"
```

---

### Task 4: Reset incompatible thinking on model switch

**Files:**
- Modify: `Sources/PipiUI/Views/SettingsSheet.swift` (`setSubagentModelOverride`, currently lines 908–919)
- Test: `Tests/PipiUITests/SubagentModelSettingsTests.swift` (append guard test)

**Interfaces:**
- Consumes: `ThinkingCapability.resolvedThinking(persisted:reasoning:thinkingLevelMap:)` (Task 1) and `ModelInfo` metadata (Task 2).
- Produces: `setSubagentModelOverride` resets an incompatible non-default persisted level to `nil` and shows a status message; the「跟随主 Agent」path is unchanged.

- [ ] **Step 1: Write the failing guard test**

Append to the `SubagentModelSettingsTests` class:

```swift
func testSetSubagentModelOverrideResetsIncompatibleThinking() throws {
    let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let source = try String(
        contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/SettingsSheet.swift"),
        encoding: .utf8
    )
    XCTAssertTrue(source.contains("ThinkingCapability.resolvedThinking("))
    // Reset message wording (approved spec §8.4).
    XCTAssertTrue(source.contains("不支持该档位"))
    // Follow-main path still clears the whole override.
    XCTAssertTrue(source.contains("setOverride(nil, thinking:"))
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `swift test --filter SubagentModelSettingsTests/testSetSubagentModelOverrideResetsIncompatibleThinking 2>&1 | tail -15`
Expected: FAIL — `resolvedThinking` is not yet referenced in `SettingsSheet.swift`. Exit non-zero.

- [ ] **Step 3: Implement reset-on-switch + a shared capability lookup**

In `Sources/PipiUI/Views/SettingsSheet.swift`, replace `setSubagentModelOverride` (currently lines 908–919) with:

```swift
private func setSubagentModelOverride(_ newValue: String, for agentName: String) {
    let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let oldThinking = subagentSettings[agentName]?.thinking
    if trimmed.isEmpty {
        // 跟随主 Agent：清空整条 override（model + thinking），无复位副作用。
        SubagentModelSettings.setOverride(nil, thinking: oldThinking, for: agentName)
        subagentSettings = SubagentModelSettings.allSettings()
        recomputePickerModels()
        statusMessage = "已保存 \(agentName) 的模型设置"
        return
    }
    // 显式 -> 显式：若旧 thinking 不被新模型支持，复位为默认。
    let cap = capability(forModelId: trimmed)
    let oldWasExplicit = (oldThinking?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
    let resolved = ThinkingCapability.resolvedThinking(
        persisted: oldThinking,
        reasoning: cap.reasoning,
        thinkingLevelMap: cap.thinkingLevelMap
    )
    let didReset = oldWasExplicit && resolved == nil
    SubagentModelSettings.setOverride(trimmed, thinking: resolved, for: agentName)
    subagentSettings = SubagentModelSettings.allSettings()
    recomputePickerModels()
    statusMessage = didReset
        ? "已重置 \(agentName) 的思考强度（\(trimmed) 不支持该档位）"
        : "已保存 \(agentName) 的模型设置"
}
```

Then add the shared lookup helper near `recomputePickerModels` (e.g. immediately after it):

```swift
/// Look up capability metadata for `modelId` from the in-memory model list. Returns
/// `(reasoning: nil, thinkingLevelMap: nil)` (unknown -> standard fallback) when the model
/// is not present, so the resolver never spuriously resets.
private func capability(forModelId modelId: String) -> (reasoning: Bool?, thinkingLevelMap: [String: String?]?) {
    guard let model = models.first(where: { $0.id == modelId }) else { return (nil, nil) }
    return (model.reasoning, model.thinkingLevelMap)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `swift test --filter SubagentModelSettingsTests/testSetSubagentModelOverrideResetsIncompatibleThinking 2>&1 | tail -15`
Expected: PASS — exit 0. (The pure reset decision logic itself is already covered by `ThinkingCapabilityTests.testResolvedThinkingResetsIncompatible` from Task 1.)

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/Views/SettingsSheet.swift Tests/PipiUITests/SubagentModelSettingsTests.swift
git commit -m "feat(subagent): reset incompatible thinking when switching models"
```

---

### Task 5: Idempotent thinking normalization on settings reload

**Files:**
- Modify: `Sources/PipiUI/Views/SettingsSheet.swift` (`reload()`, currently lines 1135–1190)
- Test: `Tests/PipiUITests/SubagentModelSettingsTests.swift` (append guard test)

**Interfaces:**
- Consumes: `ThinkingCapability.resolvedThinking` (Task 1), `capability(forModelId:)` (Task 4), `SubagentModelSettings.setOverride`.
- Produces: a silent, idempotent pass at the end of `reload()` that resets any persisted non-default thinking level the selected model cannot support.

- [ ] **Step 1: Write the failing guard test**

Append to the `SubagentModelSettingsTests` class:

```swift
func testReloadNormalizesIncompatibleThinking() throws {
    let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let source = try String(
        contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/SettingsSheet.swift"),
        encoding: .utf8
    )
    XCTAssertTrue(source.contains("normalizeSubagentThinkingIfNeeded()"))
    // Idempotent repair: persisted non-default thinking that the model disallows -> nil.
    XCTAssertTrue(source.contains("SubagentModelSettings.setOverride(model, thinking: nil, for: agent)"))
    // It must run AFTER models are loaded (so normalization is driven by fresh metadata).
    let reloadRange = source.range(of: "private func reload(restartSessions:")
    let normalizeRange = source.range(of: "normalizeSubagentThinkingIfNeeded()")
    if let r = reloadRange, let n = normalizeRange {
        XCTAssertLessThan(r.lowerBound, n.lowerBound)
    } else {
        XCTFail("reload or normalization call not found")
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `swift test --filter SubagentModelSettingsTests/testReloadNormalizesIncompatibleThinking 2>&1 | tail -15`
Expected: FAIL — `normalizeSubagentThinkingIfNeeded()` does not exist yet. Exit non-zero.

- [ ] **Step 3: Add the normalization pass and call it from `reload()`**

In `Sources/PipiUI/Views/SettingsSheet.swift`, add this method (e.g. right after the `capability(forModelId:)` helper added in Task 4):

```swift
/// Silent, idempotent upgrade repair: reset any persisted non-default thinking level that
/// the selected model can no longer support (e.g. a legacy `xhigh` choice on a standard
/// model after upgrade). No status message — this is an automatic repair, not a user action.
/// A second reload finds nothing to write because reset values are already `nil`.
private func normalizeSubagentThinkingIfNeeded() {
    var changed = false
    for (agent, override) in subagentSettings {
        let model = override.model
        guard !model.isEmpty,
              let thinking = override.thinking,
              !thinking.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { continue }
        let cap = capability(forModelId: model)
        let resolved = ThinkingCapability.resolvedThinking(
            persisted: thinking,
            reasoning: cap.reasoning,
            thinkingLevelMap: cap.thinkingLevelMap
        )
        if resolved == nil {
            SubagentModelSettings.setOverride(model, thinking: nil, for: agent)
            changed = true
        }
    }
    if changed {
        subagentSettings = SubagentModelSettings.allSettings()
    }
}
```

Then call it at the very end of `reload(restartSessions:)`, immediately after the existing `recomputePickerModels()` line at the bottom of the method:

```swift
        // models / hiddenIds / subagentSettings 已就位，重算 picker 候选与 provider 分组缓存。
        recomputeGroupedModels()
        recomputePickerModels()
        normalizeSubagentThinkingIfNeeded()
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `swift test --filter SubagentModelSettingsTests/testReloadNormalizesIncompatibleThinking 2>&1 | tail -15`
Expected: PASS — exit 0.

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/Views/SettingsSheet.swift Tests/PipiUITests/SubagentModelSettingsTests.swift
git commit -m "feat(subagent): normalize incompatible thinking on settings reload"
```

---

### Task 6: Update the approved design spec to the metadata-based source

**Files:**
- Modify: `docs/superpowers/specs/2026-07-26-subagent-thinking-capabilities-design.md`

**Why:** The spec currently describes a static curated catalog (`ThinkingCapabilityCatalog` + `Resources/thinking-capabilities.json`) as the capability source. This plan implements a metadata-based source instead. The spec must be rewritten so the approved design and the implementation agree; leaving the catalog language in place would contradict the shipped behavior.

- [ ] **Step 1: Rewrite spec §0 summary's data-source sentence**

Replace the sentence in §0 that reads `能力来源是一份**静态、策展的 capability map**（仿 ModelPricing.Catalog），而不是设置页里的 get_available_thinking_levels RPC。` with:

> 能力来源是 **model-list 元数据**：pi `Model.reasoning` 与 `Model.thinkingLevelMap`，经既有 `listModels()` / `get_available_models` 管线透出到 `ModelInfo`。不引入 catalog JSON、不在设置页加 RPC。

- [ ] **Step 2: Replace spec §5.3 / §5.4 / §5.5 with the metadata rules**

Replace the `ThinkingCapabilityCatalog` API block (§5.3), the `thinking-capabilities.json` schema (§5.4), and the curated/heuristic judgment algorithm (§5.5) with a single concise section:

> **5.3 能力解析（`ThinkingCapability`，纯 Swift）**
> 唯一能力来源是 `ModelInfo.reasoning`（pi `Model.reasoning`）与 `ModelInfo.thinkingLevelMap`（pi `Model.thinkingLevelMap`）。`ThinkingCapability.allowedLevels(reasoning:thinkingLevelMap:)` 规则：
> - `reasoning == false` → 仅「默认」。
> - `reasoning == true` → `["", "off", "minimal", "low", "medium", "high"]`，仅当 `thinkingLevelMap` 把 `xhigh`/`max` 显式映射到非空字符串时追加该档（pi 语义：缺省键用 provider 默认；`null` 表示不支持）。
> - 元数据未知（模型不在列表）→ 标准 6 档兜底，绝不静默锁掉某档。
>
> 不新增 `Resources/thinking-capabilities.json`，不新增 catalog 类，不引入启发式子串匹配。

- [ ] **Step 3: Update spec §7 file table and §14 decision 1**

In the §7 file table: remove the rows for `ThinkingCapability.swift` being a catalog and for `Resources/thinking-capabilities.json`; instead list `Sources/PipiUI/ThinkingCapability.swift` (Create, pure resolver), `Sources/PipiUI/ChatSession.swift` / `Sources/PipiUI/PiAuthHelper.swift` / `Sources/PipiUI/Resources/pi-auth-helper.mjs` (Modify, surface metadata), and keep `PiExt/subagent/index.ts` as 不改. In §14 decision 1, replace `能力来源 = 静态策展 map（…）` with `能力来源 = model-list 元数据（reasoning / thinkingLevelMap），经 listModels / get_available_models 透出`.

- [ ] **Step 4: Update spec §12 rationale lead-in**

In §12, change the opening to note that BOTH the settings-page RPC AND a bundled static catalog were rejected in favor of the existing model-list metadata; keep the existing RPC-rejection arguments as the reason the RPC was not chosen, and add one sentence: a bundled catalog would duplicate metadata already present and authoritative on every pi model object, so it would drift.

- [ ] **Step 5: Verify the spec no longer references the catalog as the source**

Run: `grep -n 'thinking-capabilities.json\|ThinkingCapabilityCatalog' docs/superpowers/specs/2026-07-26-subagent-thinking-capabilities-design.md`
Expected: no matches (exit 1 from grep). If any remain, remove them.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-26-subagent-thinking-capabilities-design.md
git commit -m "docs(spec): switch subagent thinking capability source to model metadata"
```

---

### Task 7: Whole-target verification and spawn-clamp regression guard

**Files:**
- Test only; no production changes. The existing `testSubagentExtensionUsesSeparateThinkingArgumentForExplicitOverride` in `Tests/PipiUITests/SubagentModelSettingsTests.swift` already guards the spawn clamp; this task merely runs the full suite to confirm nothing regressed and the clamp is intact.

- [ ] **Step 1: Confirm the spawn-clamp guard still exists and is unchanged**

Run: `grep -n 'stripModelThinkingSuffix\|PI_THINKING_LEVELS\|args.push("--thinking"' Sources/PipiUI/PiExt/subagent/index.ts`
Expected: three matches — `const PI_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);`, `function stripModelThinkingSuffix`, and `if (resolvedThinking) args.push("--thinking", resolvedThinking);`. The clamp is preserved.

- [ ] **Step 2: Build the package**

Run: `swift build 2>&1 | tail -15`
Expected: `Build complete!` and exit 0. No warnings introduced by the new `ThinkingCapability.swift` or the edited call sites.

- [ ] **Step 3: Run the full test suite**

Run: `swift test 2>&1 | tail -30`
Expected: `Test Suite 'PipiUITests.xctest' passed` / `Executed N tests, with 0 failures`, exit 0. This includes:
- `ThinkingCapabilityTests` (Task 1) — pure resolver correctness.
- `SubagentModelSettingsTests` (Tasks 2–5) — metadata surfacing, dynamic picker, reset, normalization, plus the pre-existing spawn-clamp guard `testSubagentExtensionUsesSeparateThinkingArgumentForExplicitOverride` still green (proves `index.ts` was not broken).

If XCTest is unavailable in the environment, substitute `swift run PipiUITestRunner` (per Constitution §5) and expect an all-pass summary; workers must NOT fall back to `make-app.sh`.

- [ ] **Step 4: No packaging step**

Do NOT run `./make-app.sh` or `./scripts/build-app.sh`. Producing `build/PipiUI.app` is a release step for the primary checkout, out of scope for this feature work. The verification gate is Steps 2–3 only.

- [ ] **Step 5: Commit (only if any test-only tweak was needed; otherwise skip)**

If no files changed in this task, skip the commit. Otherwise:

```bash
git commit --allow-empty -m "test(subagent): verify thinking-capability filtering end to end"
```

---

## Spec Coverage Matrix

| Approved spec requirement (§1 decisions / §3 goals) | Implemented in |
|---|---|
| §1.2 非推理模型 only「默认」 | Task 1 (`allowedLevels` nonReasoning), Task 3 (read-only line) |
| §1.3 standard reasoning = 默认/关闭/极低/低/中/高 | Task 1 (`standardTags`), Task 3 |
| §1.4 xhigh/max only when supported | Task 1 (`thinkingLevelMap` non-null check), Task 3 |
| §1.5 reset incompatible on model switch | Task 4 (`setSubagentModelOverride`) |
| §1.6 keep spawn clamp; UI is authority | Task 7 (clamp guard); `index.ts` unchanged throughout |
| §3.3 reload-time idempotent normalization | Task 5 (`normalizeSubagentThinkingIfNeeded`) |
| §3.5 不改派出端 | All tasks leave `PiExt/subagent/index.ts` untouched |
| Data source = metadata, not catalog, not RPC | Global Constraints; Tasks 1–2; Task 6 reconciles the spec |
