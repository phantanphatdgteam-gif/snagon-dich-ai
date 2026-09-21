import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import nounsanitized from 'eslint-plugin-no-unsanitized';

// CLAUDE.md §9 bans every network call outside src/lib/provider/, not just fetch.
const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
const GLOBAL_ALIASES = ['globalThis', 'window', 'self'];
const networkMessage = (name) => `${name} is only allowed in src/lib/provider/ (CLAUDE.md §9)`;

const restrictedGlobals = (names) => names.map((name) => ({ name, message: networkMessage(name) }));

// sendBeacon is matched on any object, so globalThis.navigator.sendBeacon is covered as well.
const restrictedProperties = (names) => [
  ...GLOBAL_ALIASES.flatMap((object) =>
    names.map((property) => ({ object, property, message: networkMessage(property) })),
  ),
  { property: 'sendBeacon', message: networkMessage('navigator.sendBeacon') },
];

// CLAUDE.md §6: tests must not reach an outside network either. They may still name `fetch`,
// because the provider takes an injected stub — createOllamaProvider({ fetch }).
const TEST_NETWORK_GLOBALS = NETWORK_GLOBALS.filter((name) => name !== 'fetch');

const HTML_SINKS = ['innerHTML', 'outerHTML', 'insertAdjacentHTML'];
const HTML_SINK_PATTERN = `^(${HTML_SINKS.join('|')})$`;
const HTML_SINK_MESSAGE =
  'innerHTML, outerHTML and insertAdjacentHTML are banned outright (CLAUDE.md §4). ' +
  'Write model output with textContent and build nodes with createElement.';

export default defineConfig([
  globalIgnores(['node_modules/', '.output/', '.wxt/', '.worktrees/', 'bench/results/']),
  tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    plugins: { nounsanitized },
    rules: {
      'nounsanitized/method': 'error',
      'nounsanitized/property': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': 'error',
      'no-restricted-globals': ['error', ...restrictedGlobals(NETWORK_GLOBALS)],
      'no-restricted-properties': ['error', ...restrictedProperties(NETWORK_GLOBALS)],
      // Complements nounsanitized/*, which only flags dynamic values: this bans the
      // sinks themselves on any object, read or write, dotted or computed.
      'no-restricted-syntax': [
        'error',
        {
          selector: `MemberExpression[computed=false][property.name=/${HTML_SINK_PATTERN}/]`,
          message: HTML_SINK_MESSAGE,
        },
        {
          selector: `MemberExpression[computed=true][property.value=/${HTML_SINK_PATTERN}/]`,
          message: HTML_SINK_MESSAGE,
        },
        {
          selector: `Property[key.name=/${HTML_SINK_PATTERN}/], Property[key.value=/${HTML_SINK_PATTERN}/]`,
          message: HTML_SINK_MESSAGE,
        },
      ],
    },
  },
  {
    files: ['src/lib/provider/**/*.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/lib/log.ts', 'bench/**/*.ts', 'scripts/**/*.mjs', 'tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...restrictedGlobals(TEST_NETWORK_GLOBALS)],
      'no-restricted-properties': ['error', ...restrictedProperties(TEST_NETWORK_GLOBALS)],
    },
  },
]);
