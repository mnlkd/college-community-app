import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Server package dependencies of ODD Table 3. infrastructure is the composition root and
// may reach every package; every package may use kernel.
const SERVER_PACKAGES = {
  kernel: [],
  infrastructure: [
    'kernel',
    'identity',
    'publishing',
    'boards',
    'mentorship',
    'opportunities',
    'groups',
    'notifications',
    'moderation',
    'analytics',
  ],
  identity: ['kernel', 'notifications'],
  publishing: ['kernel', 'identity', 'notifications'],
  boards: ['kernel', 'publishing', 'mentorship', 'opportunities', 'groups'],
  mentorship: ['kernel', 'identity', 'notifications'],
  opportunities: ['kernel', 'identity'],
  groups: ['kernel', 'identity', 'notifications'],
  notifications: ['kernel'],
  moderation: ['kernel', 'identity', 'publishing', 'opportunities', 'notifications'],
  analytics: ['kernel', 'identity', 'publishing', 'mentorship', 'opportunities', 'groups', 'moderation'],
}

// Client packages of ODD Table 4 plus the shared UI kit (design). Screens reach the server
// only through client.api.
const CLIENT_PACKAGES = {
  design: [],
  api: [],
  auth: ['design'],
  features: ['design', 'api', 'auth'],
  admin: ['design', 'api', 'auth'],
  app: ['design', 'api', 'auth', 'features', 'admin'],
}

const relativeTo = (names) => `^(\\.{1,2}/)+(${names.join('|')})(/|$)`

function serverBoundary(name, allowed) {
  const others = Object.keys(SERVER_PACKAGES).filter((other) => other !== name)
  const forbidden = others.filter((other) => !allowed.includes(other))
  const patterns = [
    {
      // A package exposes only its index (services, lifecycle handler, Input/View types).
      regex: `^(\\.\\./)+(${others.join('|')})/(?!index\\.js$)`,
      message: 'Import another package through its index.js only (ODD Section 2).',
    },
  ]
  if (forbidden.length > 0) {
    patterns.push({
      regex: relativeTo(forbidden),
      message: `ODD Table 3: ${name} may depend only on ${allowed.join(', ') || 'nothing'}.`,
    })
  }
  return {
    files: [`server/src/${name}/**/*.ts`],
    rules: { 'no-restricted-imports': ['error', { patterns }] },
  }
}

function clientBoundary(name, allowed) {
  const forbidden = Object.keys(CLIENT_PACKAGES).filter((other) => other !== name && !allowed.includes(other))
  const patterns = [
    { regex: '(^|/)server(/|$)|^@hilcoe/server', message: 'The client never imports server code.' },
  ]
  if (forbidden.length > 0) {
    patterns.push({
      regex: relativeTo(forbidden),
      message: `client.${name} may depend only on ${allowed.join(', ') || 'shared'}.`,
    })
  }
  const screens = ['features', 'admin', 'app'].includes(name)
  if (screens) {
    patterns.push({
      regex: '^@supabase/',
      message: 'Screens reach Supabase through client.auth and the server through client.api.',
    })
  }
  return {
    files: [`client/src/${name}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', { patterns }],
      ...(screens || name === 'auth'
        ? {
            'no-restricted-globals': [
              'error',
              { name: 'fetch', message: 'Call the server through client.api.' },
              { name: 'XMLHttpRequest', message: 'Call the server through client.api.' },
            ],
          }
        : {}),
    },
  }
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'server/src/generated/**',
      'playwright-report/**',
      'test-results/**',
      'supabase/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(\\.\\./)+(client|server)(/|$)|^@hilcoe/(client|server)',
              message: 'shared depends on nothing but zod.',
            },
          ],
        },
      ],
    },
  },
  ...Object.entries(SERVER_PACKAGES).map(([name, allowed]) => serverBoundary(name, allowed)),
  ...Object.entries(CLIENT_PACKAGES).map(([name, allowed]) => clientBoundary(name, allowed)),
  {
    files: ['server/scripts/**/*.ts', 'e2e/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
)
