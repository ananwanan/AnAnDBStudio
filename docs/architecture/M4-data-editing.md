# M4 SQLite 数据编辑

React 在表标签中维护内存修改集。AG Grid Community 使用 Infinite Row Model，双击或 F2 打开类型编辑器。Enter 或「确认」把值放入修改集，Esc 关闭编辑器。新增行使用独立表单，省略的列交给 SQLite 执行 DEFAULT。选择已加载的完整行可标记删除。修改集记录首次观察到的原行、最终值和操作顺序，刷新、筛选、排序、翻页和切换标签后仍可查看。回改原值会移除差异，取消待新增行会移除 INSERT，标记删除后只能在修改集中移除删除操作。修改集与数据会话均在 Dockview 持久化布局之外。

## 行身份与值

- 只接受 `main` 中 SQLite 分类为普通表的对象。视图、虚拟表和任意 SQL 结果没有网格写入入口。只读连接及 `PRAGMA query_only=ON` 禁止提交。普通列可写，生成列及隐藏列只读。
- 普通表优先使用真实的 `INTEGER PRIMARY KEY` rowid 别名，其次选择未被用户列遮蔽的 `rowid`、`_rowid_` 或 `oid`。如果三个伪列均被遮蔽，可使用声明为非空的索引主键。WITHOUT ROWID 使用 SQLite 主键索引的完整列顺序和 collation。缺少可靠身份或已达到 SQLite 结果列上限的表保留只读浏览。
- 更新和删除携带首次读取时的原行。比较保留列顺序、SQLite 存储类型、完整 int64、文本和 BLOB 字节。预览截断的行禁止更新和删除。无效 UTF-8 的 TEXT 可以参与原值比较，对应单元格禁止直接写入。可编辑值类型为 NULL、TEXT、INTEGER、REAL 和 BLOB。INTEGER 以字符串传输，BLOB 使用十六进制，单值上限 16 KiB。SQLite 根据列亲和性和 STRICT 约束决定最终存储类型。
- 删除操作绑定已选中的数据行。若缓存替换了选区内的行，须重新选择。分页和排序不参与写入的目标定位。

## IPC v1 增量

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `open_sqlite_table_result` | 原有参数，可加 `countRows` | 表会话增加 `editing`，含 schema version、只读原因、列可写性、主键列索引或 rowid 别名。可选 `observedRowCount` 为读取时计数 |
| `get_sqlite_result_page` | 原有参数 | 使用隐式 rowid 的表增加逐行对齐的十进制 `rowIds` |
| `commit_sqlite_edit` | 连接 `id`、表 `sessionId`、`operationId`、`timeoutMs`、`payload` | 成功 COMMIT 后返回 `inserted`、`updated`、`deleted` |
| `cancel_sqlite_edit` | 连接 `id`、`operationId` | 请求取消，提交命令仍负责返回最终状态 |

`payload` 是结构化 JSON 字符串，Tauri 在反序列化前检查 1 MiB 上限。每批最多 256 行。每个条目有 `kind` 及适用的 `target`（`rowId` 与 `cells`）和 `values`（列位置和值）。表名由该连接拥有的表会话提供。后端核对连接、结构版本、表、列、赋值类型、原行和实际受影响行数。错误使用既有 `AppError`，分别报告只读、SQL 事务未完成、结构已变更、行缺失、原行已变更、影响行数异常、SQLite 约束失败、数据库忙和提交结果未知。

## 事务与关闭保护

连接 worker 将批次排在已入队的读取之后，和 SQL 查询共用互斥状态。已有 SQL 手动事务时拒绝网格保存。SQLite 用 `BEGIN IMMEDIATE` 取得写锁，然后重新读取结构和每个目标行。在同一写事务内用按身份定位的 SELECT 比较完整原值，再执行绑定值的 INSERT、UPDATE 或 DELETE。写语句使用 `OR ABORT` 防止表的冲突策略隐式忽略或替换其他行。SQLite 执行 DEFAULT、AUTOINCREMENT、触发器、外键及 CHECK。网格事务期间启用外键和 CHECK，结束后恢复 SQL 编辑器的连接设置。日志关闭、纯内存日志或关闭同步的连接禁止网格保存，连接的日志和同步设置由用户控制。

目标缺失、变更、约束、忙、取消或超时都会使整批失败。SQLite 事务中断后执行清理并回滚未提交写入。最终 COMMIT 以 SQLite 返回为准，取消和连接关闭如果发生在 COMMIT 已完成之后，仍报告成功。传输故障或后端无法确认结果时保留草稿并禁用重试，用户可刷新核对后放弃草稿。成功后清空已提交的草稿，刷新同连接的表缓存。已提交表会按当前筛选尝试一次 300 ms 的计数，计数超时时继续按 M3 方式在尾页确定行数。影响行数是直接操作的行数，触发器及外键级联的间接写入由 SQLite 管理。

关闭数据标签、连接、窗口、重置布局或切换连接模式时可提交、放弃本地草稿或取消。多个表的关闭确认按表依次执行独立事务，先提交成功的表会保留结果。完全相同值和身份的删后重建无法通过原值比较识别。较大的字段可经 SQL IDE 处理，网格不会用截断值写入或比较。

复用已锁定的 AG Grid Community 和 rusqlite。rusqlite 启用既有的 `limits` 功能来读取 SQLite 结果列数上限，依赖锁文件和第三方许可保持原有版本。
