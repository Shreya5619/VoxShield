# Bugfix Requirements Document

## Introduction

The Android debug build for VoxShield fails during the CMake/ninja compilation step for the `arm64-v8a` target. The failure occurs in `react-native-safe-area-context@4.14.1`, which calls `.unit()` on a `yoga::StyleLength` object — an accessor that was removed from the Yoga layout engine API bundled with React Native 0.76+. The project uses React Native 0.86.3, which ships the newer Yoga version, making `react-native-safe-area-context@4.14.1` incompatible. The build cannot complete, blocking all Android development and testing.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the Android debug build is initiated for the `arm64-v8a` ABI THEN the system fails at the CMake compilation step with "no member named 'unit' in 'facebook::yoga::StyleLength'" errors in `RNCSafeAreaViewShadowNode.cpp` lines 19 and 22.

1.2 WHEN `react-native-safe-area-context@4.14.1` is installed alongside React Native 0.76+ THEN the system cannot compile the C++ shadow node code because `yoga::StyleLength::unit()` no longer exists in the Yoga API bundled with RN 0.76+.

1.3 WHEN the CMake build fails THEN the system aborts the `:app:buildCMakeDebug[arm64-v8a]` Gradle task, preventing any Android build from completing.

### Expected Behavior (Correct)

2.1 WHEN the Android debug build is initiated for the `arm64-v8a` ABI THEN the system SHALL compile `RNCSafeAreaViewShadowNode.cpp` without C++ errors and complete the CMake build step successfully.

2.2 WHEN a version of `react-native-safe-area-context` compatible with React Native 0.76+ is installed THEN the system SHALL resolve `yoga::StyleLength` API calls against the correct Yoga API surface, producing no compiler errors.

2.3 WHEN the CMake build step completes successfully THEN the system SHALL proceed to link and package the Android debug APK without interruption.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `SafeAreaView` is rendered on Android with padding mode THEN the system SHALL CONTINUE TO apply correct inset-aware padding values to the component's layout.

3.2 WHEN `SafeAreaView` is rendered on Android with margin mode THEN the system SHALL CONTINUE TO apply correct inset-aware margin values to the component's layout.

3.3 WHEN `SafeAreaView` is rendered on iOS THEN the system SHALL CONTINUE TO function correctly without any change in behavior.

3.4 WHEN safe area insets are queried via `useSafeAreaInsets()` or `SafeAreaConsumer` THEN the system SHALL CONTINUE TO return accurate inset values reflecting the device's safe area boundaries.

3.5 WHEN the app is built for a non-affected ABI or in release mode THEN the system SHALL CONTINUE TO build successfully with no regressions in safe area behavior.

---

## Bug Condition Derivation

**Bug Condition Function:**

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type BuildConfiguration
  OUTPUT: boolean

  // Returns true when the version mismatch triggers the build failure
  RETURN X.safeAreaContextVersion uses yoga::StyleLength::unit()
     AND X.reactNativeVersion >= 0.76 (Yoga API no longer exposes .unit())
END FUNCTION
```

**Property: Fix Checking**

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  result ← buildAndroid'(X)
  ASSERT result.cmakeExitCode = 0
    AND result.errors does NOT contain "no member named 'unit' in 'facebook::yoga::StyleLength'"
END FOR
```

**Property: Preservation Checking**

```pascal
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT buildAndroid(X) = buildAndroid'(X)
    AND safeAreaBehavior(X) = safeAreaBehavior'(X)
END FOR
```

> **F**: Original build using `react-native-safe-area-context@4.14.1` with RN 0.86.3
> **F'**: Fixed build using a `react-native-safe-area-context` version compatible with RN 0.76+
