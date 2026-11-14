// Generated fixtures are large; resolveJsonModule is off so tsc does not infer
// literal types from multi-megabyte files. Every JSON import is a ColumnarFixture.
declare module '*.json' {
  // A top-level `import type` would turn this file into a module augmentation.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const value: import('./columnar').ColumnarFixture;
  export default value;
}
