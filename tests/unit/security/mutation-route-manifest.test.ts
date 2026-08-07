import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { MUTATION_ROUTE_POLICIES } from '@/config/mutation-route-policy';

const API_ROOT = join(process.cwd(), 'src/app/api');
const MUTATION_EXPORT =
  /export\s+(?:async\s+function|function|const)\s+(POST|PUT|PATCH|DELETE)\b|export\s*\{[^}]*\b(POST|PUT|PATCH|DELETE)\b[^}]*\}/;

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

function repoPath(file: string): string {
  return relative(process.cwd(), file).replace(/\\/g, '/');
}

describe('mutation route CSRF-policy manifest', () => {
  it('every mutation route declares an explicit policy', () => {
    const missing: string[] = [];
    for (const file of findRouteFiles(API_ROOT)) {
      if (!MUTATION_EXPORT.test(readFileSync(file, 'utf8'))) continue;
      const key = repoPath(file);
      if (!(key in MUTATION_ROUTE_POLICIES)) missing.push(key);
    }
    expect(
      missing,
      `Mutation routes without a declared CSRF policy — add each to src/config/mutation-route-policy.ts:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('manifest has no stale entries', () => {
    const files = new Set(findRouteFiles(API_ROOT).map(repoPath));
    const stale = Object.keys(MUTATION_ROUTE_POLICIES).filter((k) => !files.has(k));
    expect(stale).toEqual([]);
  });
});
