# AGENTS.md — AnAnDB Studio

This document defines repository-wide instructions for coding agents and contributors working on **AnAnDB Studio**. It applies to the entire repository unless a deeper `AGENTS.md` supplies narrower, compatible instructions.

## 1. Project identity and state

- Repository: `ananwanan/AnAnDBStudio`
- Product: **AnAnDB Studio**
- Goal: a professional, cross-platform database management desktop application comparable in workflow ambition to Navicat and DBeaver.
- Selected stack: **Tauri 2 + Rust (stable) + React + TypeScript + Vite**.
- First supported database: **SQLite 3**. PostgreSQL and MySQL/MariaDB are planned for later milestones.
- Historical note: development began as documentation-only on 2026-11-07. As of 2026-11-08, M0 PRs #1–#5 were merged into `dev`; the M0 GUI/recovery checks were maintainer-reported passed, and integrated Windows/Ubuntu CI succeeded. SQLite M1.1–M1.3/M1.5 backend was integrated via PR #6, with all four jobs successful on [run 42483034461](https://github.com/ananwanan/AnAnDBStudio/actions/runs/42483034461). M1.4 dialog/explorer is on `feat/m1.4-explorer` under PR #7: the maintainer reports local tests and functional verification passed; GitHub PR integration and final-head CI remain separate gates. See `docs/acceptance/M1.md`.
- `README.md` is the product/roadmap source of truth. Do not mark planned features as implemented without evidence.

## 2. Roadmap and task boundaries

Follow the milestones and acceptance criteria in `README.md`:

| Milestone | Goal |
| --- | --- |
| M0 | Foundation: scaffold, workspaces, theme, Dockview, typed IPC, CI |
| M1 | SQLite connections and schema explorer |
| M2 | Monaco SQL IDE and query execution |
| M3 | Virtualized data browser and bounded result delivery |
| M4 | Transactional data editing; v0.1.0 MVP target |
| M5 | Visual schema design and safe migrations |
| M6 | Import/export, maintenance and backup; v0.5.0 target |
| M7 | PostgreSQL driver |
| M8 | MySQL/MariaDB driver; v0.8.0 target |
| M9 | Advanced tooling: SSH, ER diagrams, schema comparison |
| M10 | Stable cross-platform releases; v1.0.0 target |

M0 is divided into M0.1 scaffold, M0.2 Rust workspace and CI, M0.3 UI/theme, M0.4 Dockview layout, M0.5 IPC/error contract, and M0.6 cross-platform acceptance.

### Agent work protocol

1. Inspect current files, active branch, build scripts, README and existing acceptance evidence before editing.
2. State the milestone and the **smallest deliverable** that satisfies the request. Do not prematurely implement future milestones.
3. Preserve existing behavior and public contracts unless the task explicitly requires a breaking change.
4. Implement with targeted tests and error handling. Validate using the actual commands available in the repository; never invent test results.
5. Update documentation/acceptance evidence and milestone status only after verified completion.
6. Report changed files, test commands/results, limitations and remaining work. Label skipped checks honestly.
7. Do not perform unrelated refactors or modify generated files by hand when their generators are available.
8. Do not add unnecessary dependencies. Explain new dependency purpose and confirm its license is compatible with the project's eventual distribution model.

## 3. Architecture boundaries

Maintain a layered architecture:

```text
React / TypeScript UI
    ↓ typed frontend service API
Tauri commands + channels (adapter)
    ↓
Rust application services / query jobs
    ↓
Database driver contracts
    ├── SQLite 3
    ├── PostgreSQL (future)
    └── MySQL / MariaDB (future)
```

- **Core Rust crates must not depend on Tauri, React or WebView APIs.**
- The desktop adapter must not absorb SQL semantics or business rules.
- Frontend components must not have direct filesystem/database access outside explicitly authorized Tauri commands.
- The driver layer owns SQL dialect specifics, connection handling, metadata, feature detection, and type mapping.
- Use explicit driver capabilities (schema editing, transactions, explain plans, row identifiers, etc.) instead of broad assumptions.
- Prefer narrow, composable interfaces over premature universal abstractions. SQLite remains the only real driver through M6.

### Intended modules (create only when their milestone calls for them)

- `src/` — React application: workbench, editor, grid, explorer, stores, services.
- `src-tauri/` — desktop shell, permissions/capabilities, commands, state.
- `crates/anandb-core/` — driver traits and common models.
- `crates/anandb-query/` — query jobs, pagination, cancellation, result protocol.
- `crates/anandb-schema/` — schema metadata and DDL models.
- `crates/anandb-driver-sqlite/` — rusqlite implementation.
- `crates/anandb-driver-pg/`, `crates/anandb-driver-mysql/` — future milestones.
- `tests/` and `docs/acceptance/` — regression and acceptance evidence.

Never create empty placeholder crates just to match this diagram.

## 4. Backend / Rust standards

- Use stable Rust; avoid `unsafe` unless essential, documented and reviewed.
- Format with `cargo fmt` and lint with `cargo clippy` when a Cargo workspace exists.
- Use explicit error types for domain boundaries; do not replace errors with `unwrap()`/`expect()` in normal runtime paths.
- Own or serialize access to each SQLite connection via a suitable dedicated worker model. Never casually share connection objects across threads.
- Use parameterized statements for **data values**. Safely quote/validate identifiers separately; placeholders cannot represent SQL identifiers.
- Manage database lifetime explicitly: opening, closing, cancellation, idle tasks, rollback and resource cleanup.
- SQLite feature behavior must be tested against actual databases, including WAL, foreign keys and read-only mode where applicable.
- Expose cancellation honestly: cancelling a UI task must not pretend an already committed SQL write was rolled back.
- All destructive schema/data operations require an explicit user action and accurate affected-object/row reporting.

### Query result and data integrity

- Do not eager-load unbounded queries into Rust memory or into one giant IPC JSON response.
- Use bounded pages/batches, incremental transfer and virtualization. Define backpressure, limits and cleanup.
- Keep UI responsive during expensive queries; run work outside the UI thread.
- Preserve SQLite storage-class distinctions: `NULL`, integer, real, text, BLOB.
- Avoid silent loss of 64-bit precision in JavaScript. Define an explicit lossless IPC encoding for integers outside JS safe range.
- Preserve duplicate result-column names by column **position/metadata**, not solely by name-keyed JavaScript objects.
- Use a lossless BLOB representation/transport, with explicit preview and size limits.
- Do not edit query results unless each target row has a reliable unique identity (primary key or valid rowid). `WITHOUT ROWID` and computed/joined results need special handling.
- Validate affected-row counts and detect conflicting edits. Never issue broad UPDATE/DELETE due to an absent key.
- Track pending changes separately from persisted values; support explicit commit/rollback.

## 5. Frontend / TypeScript standards

- Use React functional components and TypeScript strict typing.
- Keep Tauri IPC calls centralized in typed service adapters; do not scatter stringly typed `invoke` calls among UI controls.
- Keep state ownership clear: transient component state locally, shared workbench state via Zustand, long-running result state via dedicated services.
- Use Monaco for SQL editing, Dockview for layout, AG Grid **Community** for data grids unless an explicit licensing decision changes this.
- Do not rely on paid AG Grid Enterprise features in the community build.
- Virtualize large lists/tables and avoid unnecessary rerendering of all result rows.
- Support keyboard workflows, focus management, screen scaling, light/dark themes, and Windows IME input; test actual behavior.
- Render SQL results as text/data. Never inject query output as trusted HTML.
- Treat database object names, SQL text and all connected data as untrusted input.

## 6. Security and privacy

- Apply Tauri least-privilege capabilities; only grant desktop/file APIs actually required for a feature.
- Never expose arbitrary unrestricted shell, filesystem, or network commands to the UI.
- Avoid building SQL by concatenating untrusted data values.
- Credentials belong in an OS-approved protected store once remote connections are supported; never place secrets into repository files or plaintext logs.
- Do not log private database contents, access tokens, passwords or complete connection URLs.
- Never overwrite a user database, perform an auto-migration, or change journal/locking settings silently.
- Destructive migrations must support preview, user confirmation, backup/recovery guidance and tested failure paths.

## 7. Testing and acceptance

### Required checks (when relevant and available)

- Rust: formatting, Clippy, unit tests, database integration tests.
- Frontend: TypeScript type check, lint, tests and production build.
- Desktop: Tauri startup smoke test and relevant OS acceptance checks.
- SQLite: `NULL`/BLOB/int64 round trips; quoted identifiers; PK/rowid/`WITHOUT ROWID`; paging; cancellation; multi-statement execution; transaction rollback; interrupted write scenarios.
- UI: Dock layout restore, SQL editor input/IME behavior, error messages, grid navigation and edit states.
- CI: Windows and Linux during M0; macOS validation before stable release.

Do **not** claim that a check passed unless it actually ran. If a task cannot run a platform-specific test, record it as pending.

### Definition of done

A milestone/task can be marked complete only when:

1. Its documented scope and acceptance criteria are met.
2. Relevant tests/checks pass with their commands and results recorded.
3. Data-loss, security, compatibility and performance risks have been reviewed.
4. README / architecture docs / `docs/acceptance/` are updated accurately.
5. No unapproved out-of-scope work has been introduced.

For milestone closeout, add or update `docs/acceptance/MX.md` with environment, commands, observed results, known limitations and evidence links. Do not fabricate screenshots or measurements.

## 8. Git and documentation conventions

- Proposed workflow: `main` = accepted state; `dev` = integration; `feat/m0-*`, `feat/m1-*`, etc. = narrowly scoped feature branches.
- Branches that do not yet exist must be created deliberately; do not assume they exist.
- Do not force-push, rewrite public history, delete branches, merge PRs or publish releases unless expressly requested.
- Use descriptive conventional-style commits: `docs: ...`, `feat: ...`, `fix: ...`, `test: ...`, `chore: ...`.
- Prefer small, reviewable commits focused on one subtask; do not change unrelated code.
- Keep source identifiers and code comments in English; maintain clear Chinese or bilingual product documentation as appropriate.
- Update the README roadmap only when status is evidenced; future features stay visibly **planned**.
- Keep dependency usage and license obligations documented; project license is undecided until a LICENSE file exists.
- Never add CI badge/status, coverage numbers or version claims that are not backed by real builds/releases.

## 9. Immediate next action

**M1.4 Connection UI & Schema Explorer**: M0 PR #5 and SQLite M1.1–M1.5 PR #6 were merged into `dev` on 2026-11-08. Implement the native SQLite file picker, in-memory connection state, multi-connection explorer, schema tree and error handling. Run Windows/Ubuntu CI, perform real-database desktop acceptance, then update `docs/acceptance/M1.4.md`. Do not mark M1 accepted based on code merge alone, and do not start M2 SQL execution before M1 GUI acceptance.

For the definitive scope and milestones, read [README.md](README.md).
