module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testTimeout: 20000,
  moduleNameMapper: {
    "^uuid$": "<rootDir>/tests/__mocks__/uuid.js",
  },
};
