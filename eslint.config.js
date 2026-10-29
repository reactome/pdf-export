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
      // Node runs the TypeScript as it is: a relative import must name its .ts file, and
      // one naming .js passes the type check but fails at run time.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^\\.{1,2}\\/.*\\.js$/]',
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
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked }
);
