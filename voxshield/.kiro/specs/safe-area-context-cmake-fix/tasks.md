# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - CMake Fails With Removed Yoga `unit()` Accessor
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected build behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface the concrete counterexample that demonstrates the build failure
  - **Scoped PBT Approach**: Scope the property to the concrete failing configuration — `react-native-safe-area-context@4.14.1` + RN 0.86.3 on `arm64-v8a` — to ensure reproducibility
  - Inspect `node_modules/react-native-safe-area-context/android/src/main/jni/RNCSafeAreaViewShadowNode.cpp` and confirm `.unit()` calls exist at lines 19 and 22 (isBugCondition source confirmation)
  - Run `expo run:android` (or `./gradlew :app:buildCMakeDebug[arm64-v8a]`) with the current unfixed `package.json`
  - Assert the build output contains `error: no member named 'unit' in 'facebook::yoga::StyleLength'` at `RNCSafeAreaViewShadowNode.cpp:19` and `:22`
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS / build fails (this is correct — it proves the bug exists for `isBugCondition(X)` where `X.safeAreaContextVersion = 4.14.1` and `X.reactNativeVersion = 0.86.3`)
  - Document counterexamples found (e.g., `buildCMakeDebug[arm64-v8a]` aborts with `'unit'` member error) to understand root cause
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Safe Area Runtime Behavior Unchanged for Non-Bug Inputs
  - **IMPORTANT**: Follow observation-first methodology
  - **Scoped to ¬isBugCondition inputs**: All runtime safe area interactions — inset queries, padding/margin rendering, iOS behavior — where the CMake compilation step is not involved
  - Observe: `SafeAreaView` with `edges={['top', 'bottom']}` in padding mode applies correct top/bottom padding on Android (baseline from unfixed build runtime)
  - Observe: `SafeAreaView` with `mode="margin"` applies correct margin insets on Android
  - Observe: `useSafeAreaInsets()` returns accurate `{ top, bottom, left, right }` values inside `SafeAreaProvider`
  - Observe: iOS build succeeds and safe area behavior is correct (iOS does not compile the affected CMake layer)
  - Write property-based tests asserting:
    - For all valid inset configurations (top/bottom/left/right ≥ 0), `SafeAreaView` padding exactly matches the insets provided via `SafeAreaProvider initialMetrics`
    - For all combinations of `mode` ("padding" | "margin") and `edges` arrays, the correct CSS property is applied on each specified edge
    - `useSafeAreaInsets()` returns the same values as those set in `SafeAreaProvider initialMetrics` for all valid configurations
  - Verify all property-based tests PASS on UNFIXED code (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix: upgrade `react-native-safe-area-context` to RN 0.76+ compatible version

  - [x] 3.1 Implement the fix
    - Open `package.json` and update `"react-native-safe-area-context"` from `"^4.14.1"` to `"^5.4.0"` (latest major line with full RN 0.86+ support)
    - Run `npx expo install react-native-safe-area-context` to let Expo resolve the exact compatible version for Expo SDK 57 and regenerate `package-lock.json` / `yarn.lock`
    - Alternatively run `npx expo install --check` afterward to confirm the resolved version aligns with Expo 57's peer dependency range
    - Delete the Android build cache directories: `android/.gradle`, `android/app/.cxx`, `android/app/build`
    - No changes to any JS/TSX application files are required — the public API surface (`SafeAreaView`, `useSafeAreaInsets`, `SafeAreaProvider`, `SafeAreaConsumer`) is stable across the affected version range
    - _Bug_Condition: isBugCondition(X) where X.safeAreaContextVersion = 4.14.1 AND X.reactNativeVersion >= 0.76 AND yoga::StyleLength::unit() NOT IN X.yogaApiSurface_
    - _Expected_Behavior: result.cmakeExitCode = 0 AND result.errors NOT CONTAINS "no member named 'unit' in 'facebook::yoga::StyleLength'" AND result.apkProduced = true_
    - _Preservation: SafeAreaView padding mode (3.1), margin mode (3.2), iOS behavior (3.3), useSafeAreaInsets()/SafeAreaConsumer inset accuracy (3.4), non-affected ABI/release builds (3.5)_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - CMake Build Completes Without Yoga API Errors
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected build outcome
    - Run `expo run:android` (or `./gradlew :app:buildCMakeDebug[arm64-v8a]`) with the updated `package.json`
    - Assert build completes with CMake exit code 0
    - Assert build output does NOT contain `error: no member named 'unit' in 'facebook::yoga::StyleLength'`
    - Assert an Android debug APK is produced
    - **EXPECTED OUTCOME**: Test PASSES (confirms the `isBugCondition` inputs now produce the correct expected behavior)
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Safe Area Runtime Behavior Unchanged After Fix
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run all preservation property-based tests from step 2 against the fixed build
    - Verify `SafeAreaView` padding mode still applies correct insets on Android
    - Verify `SafeAreaView` margin mode still applies correct insets on Android
    - Verify `useSafeAreaInsets()` and `SafeAreaConsumer` still return accurate inset values
    - Verify iOS build succeeds and safe area behavior is unchanged
    - Verify release build (`./gradlew assembleRelease`) succeeds with no CMake errors
    - **EXPECTED OUTCOME**: All preservation tests PASS (confirms no regressions in ¬isBugCondition behavior)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Checkpoint — Ensure all tests pass
  - Re-run the full Android debug build end-to-end and confirm the APK is produced
  - Re-run the full iOS build and confirm it succeeds
  - Re-run all property-based preservation tests and confirm they all pass
  - Run `npx expo install --check` and confirm no peer dependency warnings for `react-native-safe-area-context`
  - Ensure all tests pass; ask the user if any questions arise
