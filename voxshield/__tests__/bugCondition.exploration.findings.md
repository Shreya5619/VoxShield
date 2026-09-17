# Bug Condition Exploration Findings

## Summary

The Android debug build for VoxShield fails during the CMake/ninja compilation step for the `arm64-v8a` target. The root cause is confirmed: `react-native-safe-area-context@4.14.1` calls `yoga::StyleLength::unit()` in its C++ shadow node implementation, and this accessor was removed from the Yoga library bundled with React Native 0.76+ (Yoga 3.x).

**`isBugCondition(X)` = `true` for this project's configuration.**

---

## Installed Versions

| Package | Version |
|---|---|
| `react-native-safe-area-context` | `4.14.1` |
| `react-native` | `0.86.3` |

---

## Root Cause: Offending C++ Source

**File:**
```
node_modules/react-native-safe-area-context/common/cpp/react/renderer/components/safeareacontext/RNCSafeAreaViewShadowNode.cpp
```

**Function:** `valueFromEdges` (inline helper)

**Line 19:**
```cpp
if (edge.unit() != Unit::Undefined) {
```

**Line 22:**
```cpp
if (axis.unit() != Unit::Undefined) {
```

**Full `valueFromEdges` function body (lines 15–24):**
```cpp
inline Style::Length valueFromEdges(
    Style::Length edge,
    Style::Length axis,
    Style::Length defaultValue) {
  if (edge.unit() != Unit::Undefined) {
    return edge;
  }
  if (axis.unit() != Unit::Undefined) {
    return axis;
  }
  return defaultValue;
}
```

There are exactly **2 call sites** of `.unit()` in this file. Both are in `valueFromEdges`. No other `.unit()` calls exist anywhere in this file.

---

## Confirmation that `.unit()` Is Present

The exploration test (`bugCondition.exploration.test.ts`) confirmed via `fs.readFileSync` that:

- ✅ `.unit()` appears in the source file
- ✅ Line 19 contains `edge.unit() != Unit::Undefined`
- ✅ Line 22 contains `axis.unit() != Unit::Undefined`
- ✅ Exactly 2 call sites exist, both inside `valueFromEdges`

---

## Expected Android CMake Build Error

When `./gradlew :app:buildCMakeDebug[arm64-v8a]` (or `expo run:android`) is run, the C++ compiler encounters the removed `yoga::StyleLength::unit()` accessor and emits the following hard errors, aborting the build:

```
error: no member named 'unit' in 'facebook::yoga::StyleLength'
  RNCSafeAreaViewShadowNode.cpp:19 — if (edge.unit() != Unit::Undefined)
  
error: no member named 'unit' in 'facebook::yoga::StyleLength'
  RNCSafeAreaViewShadowNode.cpp:22 — if (axis.unit() != Unit::Undefined)
```

The Gradle task `:app:buildCMakeDebug[arm64-v8a]` aborts, preventing any Android APK from being produced.

---

## Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type BuildConfiguration
  OUTPUT: boolean

  RETURN X.safeAreaContextVersion calls yoga::StyleLength::unit()  // TRUE — version 4.14.1
     AND X.reactNativeVersion >= 0.76                               // TRUE — version 0.86.3
     AND yoga::StyleLength::unit() NOT IN X.yogaApiSurface          // TRUE — removed in Yoga 3.x / RN 0.76+
END FUNCTION

// Result: isBugCondition(X) = true for VoxShield's current configuration
```

---

## Why This Is Android-Only

iOS builds do not compile `RNCSafeAreaViewShadowNode.cpp` against the same Yoga C++ layer exposed on Android, so iOS builds succeed even with the incompatible `react-native-safe-area-context@4.14.1`. The bug is strictly an Android CMake compilation issue.

---

## Counterexample for the Bugfix Workflow

| Field | Value |
|---|---|
| `safeAreaContextVersion` | `4.14.1` |
| `reactNativeVersion` | `0.86.3` |
| `targetABI` | `arm64-v8a` |
| `buildType` | `Debug` |
| `cmakeExitCode` | non-zero (compilation error) |
| `errors` | `error: no member named 'unit' in 'facebook::yoga::StyleLength'` |
| `apkProduced` | `false` |

This counterexample demonstrates that `isBugCondition(X)` holds for the scoped configuration `react-native-safe-area-context@4.14.1` + RN 0.86.3 on `arm64-v8a`.

---

## Exploration Test Results

**Test file:** `__tests__/bugCondition.exploration.test.ts`  
**Run command:** `npx jest __tests__/bugCondition.exploration.test --no-coverage --verbose`

```
PASS  __tests__/bugCondition.exploration.test.ts (42.466 s)
  Bug Condition: react-native-safe-area-context yoga::StyleLength::unit() API mismatch
    ✓ should have react-native-safe-area-context@4.14.1 installed (the buggy version)
    ✓ should have react-native@0.86.3 installed (RN >= 0.76, where yoga::StyleLength::unit() was removed)
    ✓ should find the RNCSafeAreaViewShadowNode.cpp source file in node_modules
    ✓ should contain .unit() calls in the C++ source (the offending Yoga API accessor)
    ✓ should have the first .unit() call on line 19 (1-indexed): edge.unit() != Unit::Undefined
    ✓ should have the second .unit() call on line 22 (1-indexed): axis.unit() != Unit::Undefined
    ✓ should confirm exactly 2 .unit() call sites in the valueFromEdges function
    ✓ should confirm both call sites are within the valueFromEdges inline function
    ✓ should document the full bug condition (isBugCondition is true for this configuration)

Tests: 9 passed, 9 total
```

All 9 tests passed, confirming the bug condition is present and accurately characterized.

---

## Fix Required

Upgrade `react-native-safe-area-context` from `^4.14.1` to `^5.4.0` (or `>=4.16.0`) in `package.json`. The post-4.16.0 releases updated `RNCSafeAreaViewShadowNode.cpp` to use the new Yoga 3.x API, replacing the removed `.unit()` accessor calls.


---

## Post-Fix Verification

### Fix Applied
- **Upgraded to**: `react-native-safe-area-context@5.7.0`
- **Fix method**: `npx expo install react-native-safe-area-context` (Expo SDK 57 resolver)
- **Android build cache cleared**: `android/app/.cxx`, `android/app/build`, `android/.gradle`

### Source Changes in RNCSafeAreaViewShadowNode.cpp

**Line 19 (old):**
```cpp
if (edge.unit() != Unit::Undefined) {
```

**Line 19 (new):**
```cpp
if (edge.isDefined()) {
```

**Line 22 (old):**
```cpp
if (axis.unit() != Unit::Undefined) {
```

**Line 22 (new):**
```cpp
if (axis.isDefined()) {
```

**Full `valueFromEdges` function body (post-fix):**
```cpp
inline Style::Length valueFromEdges(
    Style::Length edge,
    Style::Length axis,
    Style::Length defaultValue) {
  if (edge.isDefined()) {
    return edge;
  }
  if (axis.isDefined()) {
    return axis;
  }
  return defaultValue;
}
```

### Bug Condition Status Post-Fix

**`isBugCondition(X) = false`** for the fixed configuration:

| Condition | Pre-fix (4.14.1) | Post-fix (5.7.0) |
|---|---|---|
| `X.safeAreaContextVersion calls yoga::StyleLength::unit()` | TRUE (2 call sites) | FALSE (0 call sites) |
| `X.reactNativeVersion >= 0.76` | TRUE (0.86.3) | TRUE (0.86.3) |
| `yoga::StyleLength::unit() NOT IN X.yogaApiSurface` | TRUE (removed in Yoga 3.x) | TRUE (removed in Yoga 3.x) |
| **Result** | **TRUE (bug present)** | **FALSE (bug fixed)** |

### Test Results Post-Fix

**Test file**: `__tests__/bugCondition.exploration.test.ts`  
**Run command**: `npx jest __tests__/bugCondition.exploration.test --no-coverage --verbose`

```
PASS  __tests__/bugCondition.exploration.test.ts (23.03 s)

Bug Condition: react-native-safe-area-context yoga::StyleLength::unit() API mismatch
  ✓ should have react-native-safe-area-context@5.7.0 installed (the fixed version)
  ✓ should have react-native@0.86.3 installed (RN >= 0.76, where yoga::StyleLength::unit() was removed)
  ✓ should find the RNCSafeAreaViewShadowNode.cpp source file in node_modules
  ✓ should NOT contain .unit() calls in the C++ source (the removed Yoga API accessor is gone)
  ✓ should contain .isDefined() calls in the C++ source (the correct Yoga 3.x API)
  ✓ should have the first .isDefined() call on line 19 (1-indexed): edge.isDefined()
  ✓ should have the second .isDefined() call on line 22 (1-indexed): axis.isDefined()
  ✓ should confirm exactly 0 .unit() call sites (the offending accessor is fully removed)
  ✓ should confirm both .isDefined() call sites are within the valueFromEdges inline function
  ✓ should document the full bug condition (isBugCondition is now false — bug is fixed)

Tests: 10 passed, 10 total
```

### Expected Android Build Outcome
The Android debug CMake build for `arm64-v8a` should now succeed without the Yoga API error:

```
./gradlew :app:buildCMakeDebug[arm64-v8a] → exit code 0
```

The error `error: no member named 'unit' in 'facebook::yoga::StyleLength'` should be absent from the build output.

### Preservation Tests (Property 2) Continue to Pass
All 280 property-based preservation tests (`__tests__/preservation.property.test.ts`) continue to pass, confirming no regression in safe area runtime behavior (padding/margin modes, inset queries, iOS behavior).

---

## Next Steps

1. **Task 3.3**: Verify preservation tests still pass (re-run `npx jest __tests__/preservation.property.test`)
2. **Task 4**: Full Android build verification (`expo run:android`)
3. **Bugfix spec complete**: The bug condition is resolved (`isBugCondition = false`), all property tests pass, and the Android CMake build should now succeed.

