# AnAnDB Studio

> A modern, cross-platform database management studio.
>
> 现代化、跨平台的专业数据库管理工具。

[![Status](https://img.shields.io/badge/status-M2%20merged%20into%20dev-yellow)](#development-roadmap--开发路线)
[![Desktop](https://img.shields.io/badge/desktop-Windows%20%7C%20Linux%20%7C%20macOS-informational)](#technical-stack)

AnAnDB Studio（仓库：`AnAnDBStudio`）定位为类似 **Navicat / DBeaver** 的专业数据库管理器，采用 **Tauri 2 + Rust + React + TypeScript** 构建。**首个目标是提供可靠、可用于实际工作的 SQLite 3 管理体验**，随后扩展 PostgreSQL、MySQL 与 MariaDB。

> **项目状态（2026-11-11）：M2 SQL IDE 已通过维护者验收并合入 `dev`（[PR #9](https://github.com/ananwanan/AnAnDBStudio/pull/9)）。** M0/M1/M2.1–M2.4 均已集成。M2 包含连接级工作线程、多语句执行、逐语句结果预览、错误定位、取消/超时、会话查询历史和快捷键。维护者确认人工验证通过；逐平台的原始桌面验证日志未随报告提供。自动化证据见 [M2 验收记录](docs/acceptance/M2.md)；合并时 Windows/Linux PR CI 尚在运行，结果以 [GitHub Actions](https://github.com/ananwanan/AnAnDBStudio/actions/runs/42947979935) 为准。**M3 — Data Browser** 已在 `feat/m3-data-browser` 实现，平台验证见 [M3 验收记录](docs/acceptance/M3.md)。尚未发布 `v0.1.0`。

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
| Frontend state | React `useSyncExternalStore` (M1.4); Zustand is a future option | Process-local connection and schema state |
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

### M2 breakdown / SQL IDE 拆分

| Task | Deliverable | Current status |
| --- | --- | --- |
| **M2.1** | Monaco SQL editor, independent Dockview query tabs, per-tab connection binding and local draft recovery | Integrated into `dev` via PR #8; maintainer reports M2 end-to-end desktop validation passed (see [M2 acceptance](docs/acceptance/M2.md)) |
| **M2.2** | Asynchronous per-connection SQL execution jobs and typed error/result protocol | Implemented; bounded worker result slots and validated IPC |
| **M2.3** | Multi-statement execution, UTF-16 error locations, cancellation and timeout | Implemented; stop-on-error, rollback of open transactions |
| **M2.4** | Result preview, session history, Ctrl/Cmd+Enter, platform acceptance | Implemented; maintainer-reported validation passed; [automated evidence and CI distinction](docs/acceptance/M2.md) |

### M3 breakdown / Data Browser 拆分

| Task | Deliverable | Acceptance focus |
| --- | --- | --- |
| **M3.1** | AG Grid Community read-only result tabs integrated with Dockview | SELECT results display in separate dockable tabs; correct column ordering and basic type rendering |
| **M3.2** | Bounded backend page/cursor protocol and result lifetime | Fetch pages on demand without collecting an unbounded result set; explicit cleanup/cancellation |
| **M3.3** | Virtual scrolling, incremental loading and cache limits | Large tables stay responsive with bounded memory |
| **M3.4** | Table browsing, filtering and sorting | Stable, correct navigation with backend-aware filter/sort semantics |
| **M3.5** | SQLite value fidelity, copy/export-selection and cross-platform acceptance | Preserve NULL, BLOB, 64-bit integers and duplicate column labels without lossy conversion |

M3 在功能分支提供只读表浏览、分页 SQL 结果、虚拟网格、排序和筛选，以及选区复制与 CSV/TSV 导出。M2 的 200 行预览仍是默认执行路径；勾选「保留完整结果」可在原查询执行时生成分页结果。参阅 [M3 开发路线](docs/roadmap/M3.md)、[架构与 IPC](docs/architecture/M3-data-browser.md)及[平台验收记录](docs/acceptance/M3.md)。可编辑单元格、修改集、提交与回滚属于 M4。

### M0 breakdown / 第一阶段拆分

| Task | Deliverable | Acceptance |
| --- | --- | --- |
| **M0.1** | Scaffold Tauri 2 + React + TypeScript + Vite | `pnpm tauri dev` launches the shell |
| **M0.2** | Rust workspace, lint/format, test baseline, CI | `cargo fmt` / `cargo clippy` / tests + frontend checks run |
| **M0.3** | shadcn/ui, Tailwind, theme tokens, dark/light mode | Theme remains consistent across components |
| **M0.4** | Dockview explorer/editor/result layout | Tabs/panels work; layout can be saved/restored |
| **M0.5** | Typed Tauri IPC, shared errors, safe command boundary | Accepted and merged into `dev` (PR #4) |
| **M0.6** | Startup, persistence, Windows/Linux acceptance | PR #5 merged; integrated `dev` CI passed, GUI/recovery maintainer-reported passed |

### M1 breakdown / SQLite Core 拆分

| Task | Delivered scope | Evidence / current status |
| --- | --- | --- |
| **M1.1** | Tauri-independent SQLite driver; existing files, read-only/read-write open | Integrated via PR #6; backend CI passed |
| **M1.2** | Connection registry, typed open/list/close IPC | Integrated via PR #6; backend CI passed |
| **M1.3** | Bounded main-schema discovery, typed schema IPC | Integrated via PR #6; backend CI passed |
| **M1.4** | Native connection dialog, workspace state, interactive schema explorer | [PR #7](https://github.com/ananwanan/AnAnDBStudio/pull/7) merged into `dev`; maintainer-reported local tests and GUI verification pass |
| **M1.5** | Connection lifecycle and error hardening | Integrated via PR #6; backend CI passed |

**Current progress (2026-11-11):** M0/M1 and all M2 SQL IDE deliverables are integrated into `dev` via [PR #9](https://github.com/ananwanan/AnAnDBStudio/pull/9) (merge commit `b667963`). Maintainer-reported M2 desktop validation passed; Windows/Ubuntu PR CI was in progress at merge time and must be assessed independently. See [M1 acceptance](docs/acceptance/M1.md), [M2.1 acceptance](docs/acceptance/M2.1.md), and [M2 acceptance](docs/acceptance/M2.md). M3 Data Browser is implemented on its feature branch, with verification recorded separately.

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

**Desktop application:** Use `dev` for the integrated M2 SQL IDE and `feat/m3-data-browser` for M3. On the M3 branch, open an existing SQLite database and double-click a table in Explorer. In a bound SQL tab, Ctrl/Cmd+Enter executes the selection or script. Enable full results before execution to open a paged query result tab. Read-write SQL execution requires confirmation. Use the checked-in lockfiles:

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
| Executable (roadmap target; not yet implemented) | `anandb` / `anandb.exe` (current package/binary: `anandbstudio`) |
| Application identifier (roadmap target; not yet implemented) | `cc.ananwanan.anandb` (current Tauri config: `com.ananwanan.anandbstudio`; decision pending) |
| First MVP target | `v0.1.0` (M4) |

## Contributing and agent guidance

See [AGENTS.md](AGENTS.md) for architecture constraints, work sequencing, coding rules and the definition of done. Decisions that change scope or architecture must update the relevant documentation in the same change.

## License

**Not yet selected.** Do not assume this repository or its future releases are open source under a specific license until a `LICENSE` file is added.
