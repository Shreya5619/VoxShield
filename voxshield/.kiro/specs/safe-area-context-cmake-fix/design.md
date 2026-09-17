# Safe Area Context CMake Fix — Bugfix Design

## Overview

The Android debug build for VoxShield fails during the CMake/ninja compilation step for the `arm64-v8a` target. `react-native-safe-area-context@4.14.1` calls `yoga::StyleLength::unit()` in `RNCSafeAreaViewShadowNode.cpp`, but that accessor was removed from the Yoga layout engine bundled with React Native 0.76+. VoxShield uses React Native 0.86.3, so the Yoga API mismatch causes a hard C++ compiler error that blocks all Android builds.

The fix is a targeted dependency version upgrade: replace `react-native-safe-area-context@4.14.1` with a version that targets the post-0.76 Yoga API surface. No application-level code changes are required. The upgrade must preserve all existing safe area runtime behavior (padding/margin insets on Android, iOS behavior, `useSafeAreaInsets()`, etc.).

---

## Glossary

- **Bug_Condition (C)**: The condition where `react-native-safe-area-context` calls `yoga::StyleLength::unit()` at compile time while RN ≥ 0.76's bundled Yoga no longer exposes that accessor.
- **Property (P)**: The desired outcome when the bug condition holds — the CMake build step completes with exit code 0 and no `'unit'` member errors.
- **Preservation**: All safe area runtime behaviors (inset values, padding/margin modes, iOS behavior, `useSafeAreaInsets()`) that must remain functionally identical after the fix.
- **`RNCSafeAreaViewShadowNode.cpp`**: The C++ shadow node implementation in `react-native-safe-area-context` that bridges Yoga layout values to React Native's shadow tree. Lines 19 and 22 are the direct call sites of `yoga::StyleLength::unit()`.
- **`yoga::StyleLength`**: A Yoga C++ struct representing a CSS length value. The `.unit()` accessor method was removed in the Yoga version bundled with React Native 0.76+.
- **`isBugCondition(X)`**: A predicate over `BuildConfiguration` that returns `true` when the installed `react-native-safe-area-context` version uses the removed `.unit()` accessor against RN ≥ 0.76's Yoga.
- **F**: The original build using `react-native-safe-area-context@4.14.1` with RN 0.86.3.
- **F'**: The fixed build using a `react-native-safe-area-context` version compatible with RN 0.76+ Yoga.

---

## Bug Details

### Bug Condition

The bug manifests when the CMake compilation step for `RNCSafeAreaViewShadowNode.cpp` is run against the Yoga headers bundled with React Native 0.76+. The `RNCSafeAreaViewShadowNode` implementation calls `.unit()` on `yoga::StyleLength` objects — an accessor that was removed from the Yoga API when RN adopted Yoga 3.x. Because `react-native-safe-area-context@4.14.1` was authored against the pre-0.76 Yoga API, the compiler cannot resolve the symbol and emits a hard error, aborting the entire Gradle build.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT: X of type BuildConfiguration
  OUTPUT: boolean

  RETURN X.safeAreaContextVersion calls yoga::StyleLength::unit()
     AND X.reactNativeVersion >= 0.76
     AND yoga::StyleLength::unit() NOT IN X.yogaApiSurface
END FUNCTION
```

### Examples

- **Primary case**: VoxShield with `react-native-safe-area-context@4.14.1` + RN 0.86.3 → CMake fails at `RNCSafeAreaViewShadowNode.cpp:19` and `:22` with `error: no member named 'unit' in 'facebook::yoga::StyleLength'`.
- **Also affected**: Any project upgrading from RN < 0.76 to RN ≥ 0.76 without updating `react-native-safe-area-context` to a post-4.14.1 compatible release.
- **Not affected**: Projects still on RN < 0.76 where the old Yoga `.unit()` accessor remains in the API.
- **Edge case — iOS**: iOS builds do not compile `RNCSafeAreaViewShadowNode.cpp` against the same Yoga C++ layer, so iOS builds succeed even with the incompatible version. The bug is Android-only at the compilation level.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- `SafeAreaView` rendered on Android in **padding mode** SHALL continue to apply correct inset-aware padding values to the component's layout.
- `SafeAreaView` rendered on Android in **margin mode** SHALL continue to apply correct inset-aware margin values to the component's layout.
- `SafeAreaView` rendered on **iOS** SHALL continue to function correctly with no change in behavior.
- `useSafeAreaInsets()` and `SafeAreaConsumer` SHALL continue to return accurate inset values reflecting the device's safe area boundaries.
- Builds for **non-affected ABIs or in release mode** SHALL continue to succeed with no regressions.

**Scope:**

All runtime safe area behaviors that do NOT involve the CMake compilation step are unaffected by this fix. This includes:

- Inset value computation and delivery to JS
- Padding and margin mode rendering on Android
- All iOS-side safe area handling
- Any consumer of `SafeAreaProvider`, `useSafeAreaInsets()`, or `SafeAreaConsumer`

---

## Hypothesized Root Cause

Based on the compiler error and the known Yoga API change timeline:

1. **Yoga API Breaking Change in RN 0.76**: React Native 0.76 upgraded its bundled Yoga to version 3.x, which removed `yoga::StyleLength::unit()`. The `unit()` accessor was replaced by checking `yoga::StyleLength::isAuto()` / `yoga::StyleLength::isUndefined()` or by accessing the underlying value through a different API.

2. **`react-native-safe-area-context@4.14.1` Targets Old API**: The shadow node implementation (`RNCSafeAreaViewShadowNode.cpp` lines 19 and 22) checks `edge.unit() != Unit::Undefined` and `axis.unit() != Unit::Undefined`. These calls are the exact removed symbols. Later releases of `react-native-safe-area-context` (4.16.0+) updated these call sites to the new Yoga 3.x API.

3. **Version Pin in `package.json`**: The project specifies `"react-native-safe-area-context": "^4.14.1"`, which allows npm/yarn to resolve to `4.14.1` as the minimum. The fix requires updating this to a version range that excludes 4.14.1 and resolves to a compatible release.

4. **No Application-Level Code Issue**: There is nothing wrong with how VoxShield uses the safe area context APIs in its own code. The failure is entirely within the native C++ layer of the third-party library.

---

## Correctness Properties

Property 1: Bug Condition — CMake Build Succeeds Without Yoga API Errors

_For any_ build configuration where `isBugCondition` holds (i.e., `react-native-safe-area-context` is upgraded to a version compatible with RN 0.76+ Yoga), the fixed build F' SHALL complete the `buildCMakeDebug[arm64-v8a]` step with exit code 0 and SHALL NOT emit `error: no member named 'unit' in 'facebook::yoga::StyleLength'` at any C++ call site.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Safe Area Runtime Behavior Unchanged

_For any_ input where `isBugCondition` does NOT hold (i.e., all runtime safe area interactions — inset queries, padding/margin rendering, iOS behavior, non-affected ABI builds), the fixed build F' SHALL produce the same runtime safe area behavior as F, preserving all inset values, rendering modes, and platform-specific behavior without regression.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

---

## Fix Implementation

### Changes Required

**File**: `package.json`

**Field**: `dependencies["react-native-safe-area-context"]`

**Specific Changes:**

1. **Update version range**: Change `"^4.14.1"` to `"^5.4.0"` (or the latest stable version compatible with RN 0.86.3). The `react-native-safe-area-context` team released compatibility fixes for RN 0.76+ Yoga in versions ≥ 4.16.0; version 5.x is the current major line with full RN 0.86+ support.

2. **Regenerate lockfile**: After updating `package.json`, run `npm install` (or `yarn install`) to regenerate `package-lock.json` / `yarn.lock` so the new resolved version is pinned consistently across environments.

3. **Rebuild native modules**: Delete the Android build cache (`android/.gradle`, `android/app/.cxx`, `android/app/build`) and re-run `expo run:android` (or `./gradlew assembleDebug`) to ensure the new native C++ source is compiled from scratch against the correct Yoga headers.

4. **No JS/TSX changes required**: The public API surface of `react-native-safe-area-context` (hooks, components, providers) is stable across the affected version range. `App.tsx` and any other consumer files do not need modification.

5. **Verify Expo SDK compatibility**: Expo 57 (used in this project) specifies a compatible version of `react-native-safe-area-context` in its peer dependencies. After upgrading, run `npx expo install --check` to confirm the new version aligns with Expo 57's expected range.

---

## Testing Strategy

### Validation Approach

Testing follows a two-phase approach: first, surface counterexamples that confirm the root cause on the unfixed code, then verify the fix eliminates the build error and preserves all runtime safe area behavior.

---

### Exploratory Bug Condition Checking

**Goal**: Confirm the root cause on the unfixed code before patching. Specifically, verify that `react-native-safe-area-context@4.14.1` is indeed the source of the `unit()` call and that no other library introduces this error.

**Test Plan**: Run the Android debug build against the current (unfixed) package.json and capture the full CMake error output. Inspect `RNCSafeAreaViewShadowNode.cpp` in the installed node_modules to confirm the offending call sites.

**Test Cases:**

1. **Full Build Failure Reproduction**: Run `expo run:android` (or `./gradlew :app:buildCMakeDebug[arm64-v8a]`) with `react-native-safe-area-context@4.14.1` installed. Confirm the build fails with the exact error at lines 19 and 22 of `RNCSafeAreaViewShadowNode.cpp`. (Will fail on unfixed code.)
2. **Source Inspection**: Open `node_modules/react-native-safe-area-context/android/src/main/jni/RNCSafeAreaViewShadowNode.cpp` and confirm `.unit()` calls exist at lines 19 and 22. (Confirms root cause.)
3. **iOS Build Pass**: Run `expo run:ios` with the same unfixed package. Confirm it builds successfully, validating that the bug is Android/CMake-specific. (Expected to pass on unfixed code.)
4. **Yoga Header Check**: Inspect `node_modules/react-native/ReactAndroid/src/main/jni/react/jni/...` or the Yoga headers bundled with RN 0.86.3 to confirm `yoga::StyleLength::unit()` is absent. (Confirms the API removal.)

**Expected Counterexamples:**

- CMake error output containing `error: no member named 'unit' in 'facebook::yoga::StyleLength'` at `RNCSafeAreaViewShadowNode.cpp:19` and `:22`.
- Root cause confirmed: `react-native-safe-area-context@4.14.1` uses removed Yoga accessor; no other library is implicated.

---

### Fix Checking

**Goal**: Verify that after upgrading `react-native-safe-area-context`, the CMake build step succeeds for all affected build configurations.

**Pseudocode:**

```
FOR ALL X WHERE isBugCondition(X) DO
  result := buildAndroid_fixed(X)
  ASSERT result.cmakeExitCode = 0
    AND result.errors NOT CONTAINS "no member named 'unit' in 'facebook::yoga::StyleLength'"
    AND result.apkProduced = true
END FOR
```

**Test Cases:**

1. **Debug Build arm64-v8a**: After upgrading, run `expo run:android` and confirm CMake completes without errors for `arm64-v8a`.
2. **Debug Build x86_64** (emulator): Confirm the build also succeeds for the emulator ABI, validating the fix is not ABI-specific.
3. **Release Build**: Run `./gradlew assembleRelease` and confirm no CMake errors in release mode.

---

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (i.e., all runtime safe area behavior), the fixed app produces the same observable behavior as the original app.

**Pseudocode:**

```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT safeAreaBehavior_original(X) = safeAreaBehavior_fixed(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (varying insets, screen sizes, orientations)
- It catches edge cases that manual unit tests might miss (e.g., devices with unusual notch configurations)
- It provides strong guarantees that behavior is unchanged for all non-buggy runtime inputs

**Test Plan**: Observe safe area behavior on the fixed build (baseline) and write property-based tests that assert the same inset delivery and rendering behavior across randomized device/orientation configurations.

**Test Cases:**

1. **Padding Mode Preservation**: Render `<SafeAreaView edges={['top', 'bottom']}>` on Android and verify padding values match device safe area insets. Observe on fixed build, then write a test asserting identical values.
2. **Margin Mode Preservation**: Render `<SafeAreaView mode="margin">` on Android and verify margin values match device safe area insets.
3. **`useSafeAreaInsets()` Preservation**: Call `useSafeAreaInsets()` in a component and verify the returned `top`, `bottom`, `left`, `right` values are non-zero on devices with a notch/home indicator.
4. **iOS Preservation**: Run the iOS build after the upgrade and verify all safe area behavior is unchanged.
5. **Context Switching Preservation**: Switch between screen orientations and verify safe area insets update correctly.

---

### Unit Tests

- Test that `SafeAreaView` with `edges={['top']}` only applies top inset padding on Android.
- Test that `SafeAreaView` with `edges={['bottom']}` only applies bottom inset padding on Android.
- Test `useSafeAreaInsets()` returns correct values when wrapped in `SafeAreaProvider`.
- Test that `SafeAreaConsumer` render prop receives accurate inset values.
- Test edge case: `SafeAreaView` with no edges prop applies all insets by default.

### Property-Based Tests

- Generate random valid inset configurations (top/bottom/left/right ≥ 0) and verify `SafeAreaView` padding exactly matches the provided insets via `SafeAreaProvider` `initialMetrics`.
- Generate random screen dimensions and verify inset values do not exceed screen dimensions.
- Generate random combinations of `mode` ("padding" | "margin") and `edges` arrays and verify the correct CSS property (padding vs. margin) is applied on each edge.
- Verify that for any non-number-key input configuration, the updated library produces the same behavior as `react-native-safe-area-context@4.14.1` did at runtime (excluding the build step itself).

### Integration Tests

- Full Android app launch on a physical device or emulator: verify the app renders without safe area layout issues after the upgrade.
- Full iOS app launch: verify no regression in safe area layout on iPhone with notch and Dynamic Island devices.
- Screen navigation: verify safe area insets are correctly applied on each screen in a multi-screen navigation stack.
- Orientation change integration: rotate device between portrait and landscape and verify insets update and layout reflows correctly.
