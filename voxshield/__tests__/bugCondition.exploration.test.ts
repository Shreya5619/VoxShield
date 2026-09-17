/**
 * Bug Condition Exploration Test — Post-Fix Verification (Task 3.2)
 *
 * This test was originally written to CONFIRM the bug condition:
 *   react-native-safe-area-context@4.14.1 called yoga::StyleLength::unit()
 *   which was removed in RN 0.76+ (Yoga 3.x).
 *
 * After the fix (upgrade to react-native-safe-area-context@5.7.0), this test
 * now validates that:
 *   - .unit() is NO LONGER present in RNCSafeAreaViewShadowNode.cpp
 *   - .isDefined() is used instead (the correct Yoga 3.x API)
 *   - isBugCondition(X) = false for the fixed configuration
 *
 * isBugCondition(X):
 *   X.safeAreaContextVersion calls yoga::StyleLength::unit()  <- now FALSE
 *   AND X.reactNativeVersion >= 0.76
 *   AND yoga::StyleLength::unit() NOT IN X.yogaApiSurface
 *
 * Build error that was present on 4.14.1 (now resolved):
 *   error: no member named 'unit' in 'facebook::yoga::StyleLength'
 *     RNCSafeAreaViewShadowNode.cpp:19 — if (edge.unit() != Unit::Undefined)
 *     RNCSafeAreaViewShadowNode.cpp:22 — if (axis.unit() != Unit::Undefined)
 */

import * as fs from 'fs';
import * as path from 'path';

const SHADOW_NODE_CPP_PATH = path.resolve(
  __dirname,
  '../node_modules/react-native-safe-area-context/common/cpp/react/renderer/components/safeareacontext/RNCSafeAreaViewShadowNode.cpp'
);

const SAFE_AREA_CONTEXT_PKG_PATH = path.resolve(
  __dirname,
  '../node_modules/react-native-safe-area-context/package.json'
);

const REACT_NATIVE_PKG_PATH = path.resolve(
  __dirname,
  '../node_modules/react-native/package.json'
);

describe('Bug Condition: react-native-safe-area-context yoga::StyleLength::unit() API mismatch', () => {
  let cppSource: string;
  let cppLines: string[];
  let safeAreaContextVersion: string;
  let reactNativeVersion: string;

  beforeAll(() => {
    cppSource = fs.readFileSync(SHADOW_NODE_CPP_PATH, 'utf-8');
    cppLines = cppSource.split('\n');

    const safeAreaPkg = JSON.parse(fs.readFileSync(SAFE_AREA_CONTEXT_PKG_PATH, 'utf-8'));
    safeAreaContextVersion = safeAreaPkg.version;

    const rnPkg = JSON.parse(fs.readFileSync(REACT_NATIVE_PKG_PATH, 'utf-8'));
    reactNativeVersion = rnPkg.version;
  });

  it('should have react-native-safe-area-context@5.7.0 installed (the fixed version)', () => {
    expect(safeAreaContextVersion).toBe('5.7.0');
  });

  it('should have react-native@0.86.3 installed (RN >= 0.76, where yoga::StyleLength::unit() was removed)', () => {
    expect(reactNativeVersion).toBe('0.86.3');
    // Verify the major.minor is >= 0.76 — the version at which Yoga 3.x was adopted
    const [major, minor] = reactNativeVersion.split('.').map(Number);
    expect(major === 0 && minor >= 76).toBe(true);
  });

  it('should find the RNCSafeAreaViewShadowNode.cpp source file in node_modules', () => {
    expect(fs.existsSync(SHADOW_NODE_CPP_PATH)).toBe(true);
  });

  it('should NOT contain .unit() calls in the C++ source (the removed Yoga API accessor is gone)', () => {
    // Post-fix: .unit() has been replaced with .isDefined() — the CMake build will succeed
    expect(cppSource).not.toContain('.unit()');
  });

  it('should contain .isDefined() calls in the C++ source (the correct Yoga 3.x API)', () => {
    // 5.7.0 replaced .unit() != Unit::Undefined with .isDefined()
    expect(cppSource).toContain('.isDefined()');
  });

  it('should have the first .isDefined() call on line 19 (1-indexed): edge.isDefined()', () => {
    // Lines are 0-indexed in the array; line 19 is index 18
    const line19 = cppLines[18];
    expect(line19).toContain('edge.isDefined()');
    expect(line19).not.toContain('edge.unit()');
    console.log(`Line 19: ${line19.trim()}`);
  });

  it('should have the second .isDefined() call on line 22 (1-indexed): axis.isDefined()', () => {
    // Lines are 0-indexed in the array; line 22 is index 21
    const line22 = cppLines[21];
    expect(line22).toContain('axis.isDefined()');
    expect(line22).not.toContain('axis.unit()');
    console.log(`Line 22: ${line22.trim()}`);
  });

  it('should confirm exactly 0 .unit() call sites (the offending accessor is fully removed)', () => {
    const unitCallMatches = cppSource.match(/\.unit\(\)/g) ?? [];
    expect(unitCallMatches.length).toBe(0);
    console.log(`Total .unit() call sites found: ${unitCallMatches.length} (expected 0)`);
  });

  it('should confirm both .isDefined() call sites are within the valueFromEdges inline function', () => {
    // The valueFromEdges function now uses the correct Yoga 3.x API
    const valueFnStart = cppSource.indexOf('inline Style::Length valueFromEdges');
    expect(valueFnStart).toBeGreaterThan(-1);

    // Find the closing brace of valueFromEdges (next blank-line-separated block)
    const valueFnEnd = cppSource.indexOf('\n\n', valueFnStart);
    const valueFnBody = cppSource.slice(valueFnStart, valueFnEnd > -1 ? valueFnEnd : undefined);

    expect(valueFnBody).toContain('edge.isDefined()');
    expect(valueFnBody).toContain('axis.isDefined()');
    expect(valueFnBody).not.toContain('edge.unit()');
    expect(valueFnBody).not.toContain('axis.unit()');
  });

  it('should document the full bug condition (isBugCondition is now false — bug is fixed)', () => {
    // Post-fix: the safeArea library no longer calls the removed .unit() accessor
    const safeAreaCallsUnitAccessor = cppSource.includes('.unit()');
    const [major, minor] = reactNativeVersion.split('.').map(Number);
    const rnIsGte076 = major === 0 ? minor >= 76 : major >= 1;

    console.log('\n=== BUG CONDITION SUMMARY (POST-FIX) ===');
    console.log(`react-native-safe-area-context version: ${safeAreaContextVersion}`);
    console.log(`react-native version: ${reactNativeVersion}`);
    console.log(`safeAreaContext calls yoga::StyleLength::unit(): ${safeAreaCallsUnitAccessor}`);
    console.log(`reactNativeVersion >= 0.76 (Yoga 3.x, unit() removed): ${rnIsGte076}`);
    console.log(`isBugCondition(X) = ${safeAreaCallsUnitAccessor && rnIsGte076}`);
    console.log('\nFix applied: .unit() replaced with .isDefined() in RNCSafeAreaViewShadowNode.cpp');
    console.log('Android CMake build should now succeed with no Yoga API errors.');
    console.log('=========================================\n');

    // Bug is FIXED: safeAreaContext no longer calls the removed .unit() accessor
    expect(safeAreaCallsUnitAccessor).toBe(false);
    expect(rnIsGte076).toBe(true);
    // Combined: isBugCondition(X) is now false — the build will succeed
    expect(safeAreaCallsUnitAccessor && rnIsGte076).toBe(false);
  });
});
