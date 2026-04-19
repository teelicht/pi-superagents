# Spec Review: Task 1 - Runtime Config Store

## Status: ❌ Issues Found

---

## Required Exports (✅ All Present)

| Export | Status | Location |
|--------|--------|----------|
| `createRuntimeConfigStore()` | ✅ Present | `src/extension/config-store.ts:127` |
| `loadRuntimeConfigState()` | ✅ Present | `src/extension/config-store.ts:77` |
| `RuntimeConfigStore` | ✅ Present | `src/extension/config-store.ts:40` |

---

## Functionality Review

### 1. Load defaults when no user config exists ✅

**Status**: Compliant

**Verification**:
- `loadRuntimeConfigState()` loads `bundledDefaultConfigPath` with fallback `{}`
- Test `"returns a valid state when user config is absent"` verifies this behavior
- Path: `src/extension/config-store.ts:78-79`

---

### 2. Reload user overrides while preserving the same gate object ❌ CRITICAL

**Status**: NON-COMPLIANT

**Requirement**: "The gate object identity must be stable across reloads"

**Current Implementation** (lines 130-132):
```typescript
getGateState(): ConfigGateState {
    return assignGate(currentState);
}
```

**Problem**: Every call to `getGateState()` returns a **new object** via `assignGate()`. This means:
1. If a client captures `const gate = store.getGateState()`
2. Then calls `store.reloadConfig()`
3. The captured `gate` still points to the **old object**

**Missing Test**: No test verifies that the SAME object reference returned by `getGateState()` is updated on reload.

**Test Issue**: The test `"returns stable ConfigGateState object identity"` (line 188-199) actually tests the OPPOSITE - it verifies that `asGateState()` creates a fresh object. The test description contradicts the requirement.

---

### 3. Block invalid JSON and keep a formatted diagnostic message ✅

**Status**: Compliant

**Implementation** (lines 97-114):
- Catch block handles JSON parse errors
- Creates `config_load_failed` diagnostic with `path: "config.json"`
- Calls `formatConfigDiagnostics()` which produces:
  - "pi-superagents is disabled because config.json needs attention"
  - "Path: {configPath}"

---

### 4. Block invalid model tier values through normal validation ⚠️ PARTIAL

**Status**: Functionality exists, test coverage missing

**Implementation**:
- `validateModelTier()` exists in `src/execution/config-validation.ts:149`
- Error path format: `superagents.modelTiers.{tierName}.model`
- For `"superagents.modelTiers.balanced.model"`, the path would be correct

**Missing Test**: No test case verifies invalid model tier values produce the expected diagnostic with path `"superagents.modelTiers.balanced.model"`.

---

## Test Coverage Review

| Required Test | Status | Notes |
|--------------|--------|-------|
| Startup config loading verification | ✅ Covered | `"loads runtime config at startup"` |
| Reload functionality tests | ✅ Covered | `"provides fresh config via getConfig after reload"` |
| Diagnostics capture verification | ✅ Covered | `"updates gate state diagnostics on reload after config fix"` |
| Stable ConfigGateState object identity | ❌ WRONG | Test tests NEW object creation, not stable identity |

---

## Summary of Issues

| # | Severity | Issue | File:Line |
|---|----------|-------|-----------|
| 1 | CRITICAL | Gate object identity not stable across reloads - `getGateState()` returns new object each call | `src/extension/config-store.ts:130-132` |
| 2 | CRITICAL | Missing test: no verification that `getGateState()` returns stable reference across reloads | `test/unit/config-store.test.ts` |
| 3 | Minor | Test `"returns stable ConfigGateState object identity"` tests wrong behavior (new object) | `test/unit/config-store.test.ts:188-199` |
| 4 | Minor | Missing test: invalid model tier validation (e.g., `superagents.modelTiers.balanced.model`) | `test/unit/config-store.test.ts` |

---

## Recommendations

1. **Fix gate object stability**: Store should return the same `ConfigGateState` object that gets mutated on reload, OR maintain a single cached object that `assignGate()` updates in place.

2. **Add correct identity test**: Verify that calling `store.getGateState()` returns the same object reference before and after `store.reloadConfig()`.

3. **Add model tier validation test**: Add test case with invalid model tier config to verify diagnostic path format.

---

*Review completed: 2026-04-19*
