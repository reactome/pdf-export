// typescript-eslint's strict, type-checked rules over the TypeScript (spec 001 T001).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', '.specify/', 'specs/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A field left out of an object by destructuring the rest is not a mistake.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // Node runs the TypeScript as it is: a relative import must name its .ts file, and
      // one naming .js passes the type check but fails at run time.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression)[source.value=/^\\.{1,2}\\/.*\\.js$/]',
          message: 'Import the .ts file: Node runs the TypeScript as it is.',
        },
      ],
      // node:test's test() and describe() return promises the runner awaits itself.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['test', 'describe', 'it'] },
          ],
        },
      ],
    },
  },
  // Every exported function says what it returns, and so does every function in `src/`
  // whose type is not given by where it is used.
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
    },
  },
  // Nothing taken on trust: what the code reads (graph rows, JSON, HTTP bodies, files,
  // what pdf.js gives back) arrives as `unknown` and is checked into its type, so `src/`
  // has no `as` at all. Scripts and tests may assert a type they have just parsed, never
  // an object literal's.
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  {
    files: ['ci/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
    },
  },
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked }
);
