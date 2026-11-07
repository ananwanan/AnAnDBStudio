# AnAnDB Studio

> A modern, cross-platform database management studio.
>
> 现代化、跨平台的专业数据库管理工具。

[![Status](https://img.shields.io/badge/status-M0%20in%20progress-blue)](#development-roadmap--开发路线)
[![Desktop](https://img.shields.io/badge/desktop-Windows%20%7C%20Linux%20%7C%20macOS-informational)](#technical-stack)

AnAnDB Studio（仓库：`AnAnDBStudio`）定位为类似 **Navicat / DBeaver** 的专业数据库管理器，采用 **Tauri 2 + Rust + React + TypeScript** 构建。**首个目标是提供可靠、可用于实际工作的 SQLite 3 管理体验**，随后扩展 PostgreSQL、MySQL 与 MariaDB。

> **项目状态（2026-11-07）：M0 基础建设阶段。** Tauri 2 + React + TypeScript 工程已初始化；M0.2 Rust Workspace 与 Windows/Ubuntu CI 已通过自动验证，项目维护者报告本地 M0.2 测试完成。M0.2 在功能分支 `feat/m0-workspace-ci`，尚待 PR #1 审核合入 `dev`。SQLite 等业务功能仍未实现。`v0.1.0` 是计划中的 MVP，并非已发布版本。

## Product goals / 产品目标

- **SQL IDE**：多标签 SQL 编辑、语法高亮、补全、执行历史、错误定位、执行计划及查询取消。
- **Database explorer**：连接管理；表、列、索引、视图、触发器等对象的浏览与检索。
- **Professional data grid**：虚拟滚动、分批加载、筛选、排序、复制粘贴、BLOB/NULL 正确呈现及可控编辑。
- **Safe data operations**：待提交修改预览、事务提交/回滚、只读连接、明确的危险操作确认。
- **Visual schema tools**：表与索引设计器、DDL 预览、SQLite 安全迁移。
- **Cross-platform desktop**：优先验证 Windows / Linux，macOS 纳入正式发布目标。
- **Extensible drivers**：首发 SQLite 3；后续 PostgreSQL、MySQL / MariaDB。

## Technical stack / 技术栈

| Layer | Planned technology | Responsibility |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Desktop window, capabilities, IPC, packaging |
| Backend | Rust (stable) | Database access, schema operations, query jobs |
| Frontend | React + TypeScript + Vite | Workbench UI |
| UI components | shadcn/ui + Tailwind CSS | Theme and shared controls |
| SQL editor | Monaco Editor | SQL editing experience |
| Data grid | AG Grid Community | Virtualized result display and editing |
| Workspace | Dockview | Tabs, docking, split panels, layout persistence |
| Frontend state | Zustand | UI state management |
| SQLite driver | rusqlite | SQLite 3 implementation |
| Async orchestration | Tokio + dedicated DB workers | Job control, cancellation and messages |
| Transport | Tauri commands + channels | Typed request/response and incremental results |

Dependencies will be selected and pinned when each feature is implemented. The free/community component feature sets and licenses must be verified before use.

## Architecture / 架构

**The database core must not depend on Tauri or React.** Tauri is an adapter; React is a presentation layer. Database-specific semantics belong in drivers, not in generic UI widgets.

```text
React + TypeScript
  ├── Dockview workbench / Monaco SQL editor / AG Grid
  └── Typed frontend service layer
                  │
         Tauri Commands / Channels
                  │
          Rust desktop adapter
                  │
       Application / Query services
         ├── Connections and jobs
         ├── Result streaming / cancellation
         ├── Change sets / transactions
         └── Schema models and capabilities
                  │
            Driver interface
         ├── SQLite 3 (first)
         ├── PostgreSQL (M7)
         └── MySQL / MariaDB (M8)
```

### Target repository layout

This is a **target structure**, not a claim that these paths already exist.

```text
AnAnDBStudio/
├── Cargo.toml                  # Rust workspace
├── package.json
├── src/                        # React application
│   ├── app/
│   ├── components/
│   ├── workbench/
│   ├── editor/
│   ├── grid/
│   ├── explorer/
│   ├── services/
│   ├── stores/
│   └── styles/
├── src-tauri/                  # Tauri IPC/desktop adapter
│   ├── src/
│   │   ├── commands/
│   │   └── state/
│   └── capabilities/
├── crates/
│   ├── anandb-core/            # Common driver contracts
│   ├── anandb-query/           # Query jobs/results
│   ├── anandb-schema/          # Metadata and DDL models
│   ├── anandb-driver-sqlite/   # First implementation
│   ├── anandb-driver-pg/       # Planned M7
│   └── anandb-driver-mysql/    # Planned M8
├── tests/
├── docs/
│   ├── architecture/
│   ├── roadmap/
│   └── acceptance/
└── .github/workflows/
```

## Development roadmap / 开发路线

Every milestone requires documented acceptance evidence. **A milestone is not complete merely because code has been merged.**

| Milestone | Scope | Minimum acceptance |
| --- | --- | --- |
| **M0 — Foundation** | Tauri/React app, Rust workspace, theme, docking, IPC, CI | Desktop shell starts; layout persists; Windows/Linux build checks pass |
| **M1 — SQLite Core** | Open/close, read-only mode, connections, explorer, schema metadata | Open a real SQLite DB and correctly browse its objects |
| **M2 — SQL IDE** | Monaco tabs, multi-statement execution, errors, history, cancellation | Execute SQL and report individual errors without blocking UI |
| **M3 — Data Browser** | Result tabs, virtual grid, paging/streaming, filters, sorting | Large results are browsable without full-table materialization |
| **M4 — Data Editing** | INSERT/UPDATE/DELETE, change sets, transactions, commit/rollback | All edits are auditable and reversible before commit; **v0.1.0 MVP** |
| **M5 — Schema Designer** | Tables, columns, indexes, views, DDL preview, migrations | Schema changes validated; SQLite table rebuilds are recoverable |
| **M6 — Import/Export & Maintenance** | CSV/JSON/SQL, backup, integrity checks | Round-trip data checks; **target v0.5.0 SQLite edition** |
| **M7 — PostgreSQL** | Driver, schemas, SQL dialect/types, connection management | Database-specific tests pass |
| **M8 — MySQL/MariaDB** | Driver, types, dialect and metadata | Database-specific tests pass; **target v0.8.0** |
| **M9 — Advanced Tools** | SSH, ER diagrams, schema comparison, extension design | Security/performance review of advanced features |
| **M10 — Release** | Windows/Linux/macOS packaging, signing, QA, release process | Release gates pass; **target v1.0.0** |

### M0 breakdown / 第一阶段拆分

| Task | Deliverable | Acceptance |
| --- | --- | --- |
| **M0.1** | Scaffold Tauri 2 + React + TypeScript + Vite | `pnpm tauri dev` launches the shell |
| **M0.2** | Rust workspace, lint/format, test baseline, CI | `cargo fmt` / `cargo clippy` / tests + frontend checks run |
| **M0.3** | shadcn/ui, Tailwind, theme tokens, dark/light mode | Theme remains consistent across components |
| **M0.4** | Dockview explorer/editor/result layout | Tabs/panels work; layout can be saved/restored |
| **M0.5** | Typed Tauri IPC, shared errors, safe command boundary | A minimal typed frontend-to-Rust command works |
| **M0.6** | Startup, persistence, Windows/Linux acceptance | Repeatable smoke-test evidence documented |

**Current progress (2026-11-07):** M0.1 scaffold committed; M0.2 local validation reported complete and Windows/Ubuntu CI passed ([acceptance evidence](docs/acceptance/M0.2.md), [PR #1](https://github.com/ananwanan/AnAnDBStudio/pull/1)). Merge the reviewed M0.2 branch into `dev` before starting **M0.3**. Do **not** implement SQLite CRUD or PostgreSQL during M0 just to enlarge the scope.

## Engineering invariants / 工程底线

1. **Data safety first.** Default to safe actions; explicit confirmation for destructive commands. Never silently commit user edits.
2. **SQLite correctness.** Preserve `NULL`, BLOB, TEXT, INTEGER (including values outside JavaScript's safe integer range), REAL and duplicate result-column names without lossy conversions.
3. **Editable-row identity.** Require a stable primary key or valid row identifier before enabling in-place modification; otherwise keep results read-only.
4. **Responsive UI.** Do not run blocking SQL on the UI thread. Use dedicated database workers and cancellation-aware jobs.
5. **Bounded memory.** Use pagination/streaming and virtualized rows; never eagerly collect arbitrary result sets into a giant JSON payload.
6. **Transactional editing.** Separate persisted rows from pending edits; verify affected-row counts and support rollback.
7. **Capability-based drivers.** Common interfaces model capabilities explicitly; do not assume all databases share SQLite SQL or DDL semantics.
8. **Least privilege.** Minimize Tauri capabilities; do not expose arbitrary filesystem or shell access to frontend code.
9. **No secret leaks.** Do not commit credentials or log connection secrets, query parameters with sensitive data, or raw DB content.
10. **Tests are required.** Favor Rust unit/integration tests and automated UI checks, plus manual acceptance for platform-specific interactions.

## Development workflow / 分支约定

Planned branch policy:

- `main`: accepted, releasable state.
- `dev`: integration branch for ongoing work (to be created during setup).
- `feat/m0-...`, `feat/m1-...`, etc.: focused milestone branches from `dev`.
- Changes should be reviewed and validated before merging into `dev`; promotion to `main` follows milestone acceptance.
- CI must cover at least Windows and Linux once M0.2 is implemented; macOS is added before release.

Acceptance evidence belongs under `docs/acceptance/` when that directory is created. Keep the README milestone status aligned with actual test results.

## Getting started / 快速开始

**Scaffolded application:** On a branch containing M0.1 (such as `dev`), install dependencies and launch the desktop shell. The Rust workspace, CI and other M0.2 changes are present on `feat/m0-workspace-ci` until merged.

```powershell
pnpm install
pnpm tauri dev
```

Rust/toolchain and platform dependencies follow the official Tauri 2 setup instructions:
https://v2.tauri.app/start/prerequisites/

## Planned application identity

| Field | Value |
| --- | --- |
| Product | AnAnDB Studio |
| Repository | `ananwanan/AnAnDBStudio` |
| Executable (planned) | `anandb` / `anandb.exe` |
| Application identifier (planned) | `cc.ananwanan.anandb` |
| First MVP target | `v0.1.0` (M4) |

## Contributing and agent guidance

See [AGENTS.md](AGENTS.md) for architecture constraints, work sequencing, coding rules and the definition of done. Decisions that change scope or architecture must update the relevant documentation in the same change.

## License

**Not yet selected.** Do not assume this repository or its future releases are open source under a specific license until a `LICENSE` file is added.
