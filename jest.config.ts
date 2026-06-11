import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  testEnvironment: 'node',
  coverageProvider: 'v8',
  roots: ['<rootDir>/tests'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/e2e/'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  collectCoverageFrom: [
    'src/lib/db/**/*.ts',
    'src/lib/user.ts',
    'src/lib/cookie.ts',
    'src/app/actions.ts',
    '!**/*.d.ts',
  ],
  coverageReporters: ['text', 'html', 'lcov'],
};

export default createJestConfig(config);
