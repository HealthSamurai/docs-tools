# docs-tools

Lint, image optimization, and OG image generation for HealthSamurai documentation repos.

## Setup (new docs repo)

Prerequisites: [Bun](https://bun.sh) installed.

Run the init script once from the docs repo root:

```bash
cd ~/dev/hs/auditbox-docs
bun ~/dev/hs/docs-tools/scripts/init.ts
```

This creates:
- `package.json` with all scripts and `docs-tools` as a git dependency
- `.github/workflows/docs.yml` for CI
- `.gitignore` entries (`node_modules/`, `.docs-tools/`)
- pre-push git hook (`bun lint` before every push)

Commit the generated files and push.

## For developers (existing repo)

If the repo is already set up, just install:

```bash
bun install
```

This pulls `docs-tools` from GitHub and automatically installs the pre-push hook. No need to clone `docs-tools` separately.

## Commands

```bash
bun lint                       # run all 14 checks
bun lint:check broken-links    # run a single check
bun lint:json                  # JSON output (for CI)

bun images:check               # find unoptimized images (>500KB, not WebP)
bun images:optimize            # convert PNG/JPG to WebP + update .md refs
bun images:dry-run             # show what would change

bun og:generate                # generate OG images for all pages
bun og:dry-run                 # show what would be generated
bun og:diff                    # only for pages changed since last commit
```

## Checks

| Check | Severity | What it does |
|-------|----------|-------------|
| `frontmatter-yaml` | error | YAML frontmatter parses without errors |
| `h1-headers` | error | At most one `# H1` per file |
| `empty-headers` | error | No empty `## ` headers |
| `broken-references` | error | No `(broken-reference)` links |
| `image-alt` | warning | Images have non-empty alt text |
| `deprecated-links` | error | No links containing `deprecated` in path |
| `absolute-links` | error | No absolute links to own docs domain |
| `ampersand-summary` | error | No `&` in SUMMARY.md titles (use `and`) |
| `summary-sync` | error | SUMMARY.md entries match files on disk |
| `title-mismatch` | error | SUMMARY title matches file H1 |
| `redirects` | error | Redirect targets in `redirects.yaml` exist |
| `broken-links` | error | All internal links resolve to existing files |
| `missing-images` | error | All referenced images exist |
| `orphan-pages` | warning | Pages have at least one incoming link |

## Configuration

Optional `docs-lint.yaml` in repo root. Zero config works for standard GitBook structure.

```yaml
docs_dir: docs                  # default
assets_dir: assets              # default
summary: SUMMARY.md             # default
redirects: redirects.yaml       # default
exclude: [deprecated]           # default

checks:
  disable: []                             # check IDs to skip
  warn_only: [image-alt, orphan-pages]    # default

  absolute-links:
    domains: [docs.aidbox.app]            # domains to flag

og:
  brand: Aidbox                 # product name on OG image
  color: "#D95640"              # brand accent color
  logo: ./assets/logo.svg       # optional logo
```

## CI

The init script creates `.github/workflows/docs.yml` with two jobs:

**lint** (on push + PR to main):
```
bun install → bun lint
```

**images** (on push to main only):
```
bun install → bun images:optimize → bun og:generate → auto-commit
```

## Pre-push hook

Installed automatically on `bun install` (via `postinstall` → `install-hooks`). Runs `bun lint` before every `git push`. If lint fails, push is blocked.

To reinstall manually:

```bash
bun lint --install-hook
```

## Updating docs-tools

To get the latest version in a docs repo:

```bash
bun update docs-tools
```

## Project structure

```
src/
├── cli.ts                  # docs-lint entry point
├── runner.ts               # check orchestrator
├── config.ts               # config loading + defaults
├── types.ts                # Check, CheckResult, Issue, Config
├── output.ts               # colored terminal output
├── install-hooks.ts        # auto-installs pre-push hook
├── lib/
│   ├── files.ts            # glob markdown files
│   ├── markdown.ts         # code-block-aware line walker, frontmatter
│   ├── links.ts            # link extraction + resolution
│   └── summary.ts          # SUMMARY.md parser
├── checks/
│   └── *.ts                # 14 check implementations
├── images/
│   ├── cli.ts              # docs-images entry point
│   ├── check.ts            # find unoptimized images
│   ├── optimize.ts         # WebP conversion via sharp
│   └── update-refs.ts      # update .md refs after conversion
└── og/
    ├── cli.ts              # docs-og entry point
    ├── generate.ts         # satori + sharp OG generation
    └── template.tsx        # OG image layout
scripts/
└── init.ts                 # one-time repo setup script
action/
└── action.yml              # GitHub composite action
```
