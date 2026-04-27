// CJS stub for uuid v13 (ESM-only) — used only during Jest runs
let counter = 0;
module.exports = {
    v4: () => `test-uuid-v4-${++counter}`,
    v1: () => `test-uuid-v1-${++counter}`,
    v3: () => `test-uuid-v3-${++counter}`,
    v5: () => `test-uuid-v5-${++counter}`,
    v6: () => `test-uuid-v6-${++counter}`,
    v7: () => `test-uuid-v7-${++counter}`,
};
