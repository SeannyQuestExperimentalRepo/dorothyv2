# Phase 4: Build & Config Optimization

You are optimizing a Next.js 14 app's build configuration. Make ONE targeted change per iteration to reduce build output size or improve build performance.

## STRICT RULES

- You MAY modify config files at the repo root: `next.config.mjs`, `tailwind.config.ts`, `tsconfig.json`, `package.json`
- You MAY also modify files inside `src/`
- DO NOT create new files, Dockerfiles, or scripts
- Make exactly ONE optimization per iteration
- Run `npm run build` after your change to verify it compiles
- If build fails, revert immediately with `git checkout -- .`
- Write a one-line summary of what you changed

## TARGETS (pick ONE per iteration)

### 1. Add compiler.removeConsole to next.config.mjs

File: `next.config.mjs`

Add `compiler: { removeConsole: { exclude: ['error', 'warn'] } }` to strip console.log from production builds. This goes at the top level of the config object (not inside `experimental`).

Current config only has `experimental.outputFileTracingExcludes` and `experimental.outputFileTracingIncludes`.

### 2. Optimize tsconfig.json

File: `tsconfig.json`

- Add `"skipLibCheck": true` if not already present (speeds up type checking)
- Add `"incremental": true` if not already present (caches type check results)

### 3. Move script-only dependencies to devDependencies

File: `package.json`

Check if these packages are only used in `scripts/` (not in `src/`):
- `cheerio` — grep for imports in src/. If only used in scripts, move to devDependencies
- `xlsx` — grep for imports in src/. If only used in scripts, move to devDependencies

Use `grep -r "cheerio\|xlsx" src/` to verify before moving.

### 4. Optimize Tailwind config

File: `tailwind.config.ts`

- Check if the `content` array references paths that don't exist (like a `pages/` directory)
- Ensure content paths are as specific as possible to avoid scanning unnecessary files

### 5. Review and remove unused dependencies

File: `package.json`

Check for packages in dependencies that aren't imported anywhere in `src/`:
- `openai` — is it used in src/ or only in scripts?
- Any other packages that might only be used at build time

Use `grep -r "from ['\"]PACKAGE" src/` to verify each one.

### 6. Next.js build optimization flags

File: `next.config.mjs`

Consider adding:
- `poweredByHeader: false` — removes X-Powered-By header (minor security + size win)
- `reactStrictMode: true` — if not already set (catches issues, no prod overhead)

## ALREADY DONE (do NOT repeat)

{{BLOCKLIST}}

## CONTEXT

{{CONTEXT}}
