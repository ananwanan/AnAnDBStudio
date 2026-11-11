# M3 数据浏览与结果会话

## 两种结果来源

- **表浏览**在既有 SQLite 连接线程上生成只读计划。Rust 校验 main 下的普通表及其列，用双引号引用标识符。筛选值按 TEXT、INTEGER、REAL 或 BLOB 绑定。排序方向和操作符来自枚举。NULL 使用专用谓词。包含文本使用 SQLite `instr()`，LIKE 保留 SQLite 的匹配规则。
- **SQL 结果**在编辑器勾选「保留完整结果」时，由原始语句执行逐行产生。SQLite 判定为只读且返回列的语句可以保留结果。驱动把类型化行写入由操作系统清理的匿名临时文件，每 32 行记录一个偏移量。完成后，结果标签从该文件取页，最多跳过 31 个索引间隔内的行。写语句及 RETURNING 沿用 M2 的影响行数和预览流程。脚本、多语句错误定位、取消和开放事务回滚使用既有 M2 执行路径。

表页执行 `ORDER BY … LIMIT ? OFFSET ?`，多取一行判断是否到末尾。默认用可访问的 rowid。WITHOUT ROWID 使用主键列及实际索引的排序方向和 collation。显式单列排序追加相同键作次级排序。当所有 rowid 别名都被用户列遮蔽时，使用主键和 BINARY 列值排序，可见值完全相同的行没有可区分的顺序。

每次表元数据或数据页读取有一个短的 DEFERRED 事务；SQL 编辑器已打开显式事务时，浏览沿用该事务的视图，生命周期仍由编辑器控制。读完一页即可释放浏览自己的锁。相邻页可看到不同快照，并发插入或删除可能使 OFFSET 页重复或漏行。DDL 导致 schema version 改变后，旧表会话失效。索引有助于筛选和排序。深 OFFSET 仍需遍历前缀，不匹配索引的排序可能先扫描或排序大量行。

## IPC v1 增量命令

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `open_sqlite_table_result` | `id`、`request: {schema, table, sort, filter}`、`timeoutMs` | `ResultInfo`，列名按位置，表总行数未知 |
| `get_sqlite_result_page` | `id`、`sessionId`、零基 `offset`、`limit`、`timeoutMs` | `{rows, end}`，行与列都是有序数组 |
| `close_sqlite_result` | `id`、`sessionId` | 幂等释放，取消该会话在途读取 |
| `export_sqlite_selection` | `format: "csv" \| "tsv"`、`data` | 用户选择本地新文件并成功保存时返回 `true`，取消对话框返回 `false` |

`start_sqlite_query` 可选 `capture: true`。结果轮询每条语句增加可选 `fullResult: ResultInfo` 或 `fullResultError`。旧参数继续有效，默认执行保留 M2 预览语义。

`ResultInfo` 包括十进制字符串 `id`、`columns: string[]`、`maxPageSize` 和 `rowCount: number | null`。结果 ID 在进程内唯一，并由指定连接校验所有权。表请求最多支持一个筛选和一个排序。筛选的 `operator` 支持 `eq/ne/gt/lt/ge/le/contains/like/isNull/isNotNull`；带值运算使用 `{type, value}`，值始终以字符串过 IPC，再由 Rust 按声明的类型绑定。

失败使用现有 `AppError`。结果过期、取消、超时、连接繁忙和导出失败分别有错误码。页面超时包含在线程队列中等待的时间。OFFSET 的协议上限为 2,147,483,647。查询与浏览共享同一 SQLite 连接线程，单连接最多 8 个在途或排队浏览请求，浏览请求遇到 SQL/schema 操作会收到繁忙错误并由前端有限重试；新 SQL 作业排在已进入队列的读取之后。关闭连接会停止查询并回收该连接的所有结果。

## 容量与值表示

- 页大小可选 25、50、100 行，受列宽对应的 `maxPageSize` 和 4 MiB 页预算限制。每行的变长字段共享 24 KiB 保守的编码预算。表列数上限为 2,048。单元格最多保留 16 KiB 原始内容，超出预算返回有类型和原始字节数的预览。
- AG Grid Community Infinite Row Model 每标签默认缓存 4 个块，保留当前视口所需的块。每标签至多 2 个并发页请求，70 ms 合并快速滚动。数据标签全局上限为 12 个。工作台使用 Dockview 的指针拖放模式在同一个 WebView 内移动和分屏；刷新、变更页大小、跳转或变更排序/筛选会销毁旧数据源。数据标签只在当前进程有效，布局存储剥离标题与会话参数。
- 每连接最多 32 个表会话和 4 份已保留 SQL 结果。每份 SQL 结果最多 64 MiB 或 100 万行，按 32 行建立稀疏偏移索引。超过上限时显示说明并保留可用的 M2 预览。保留结果按最近访问淘汰，闲置约 30 分钟释放。完成捕获后没有游标或读事务；捕获期间大结果仍受 SQL 作业超时限制。
- 行的列位置即列身份，允许同名列。INTEGER 使用有符号十进制字符串，REAL 使用可往返的字符串。NULL、空 TEXT、有效 UTF-8 TEXT、无效 UTF-8 TEXT 的十六进制字节、BLOB 十六进制及各自受限预览都有独立标记。
- BLOB 默认展示字节数，悬停至多显示 32 字节十六进制。选区可通过 Shift+单击或 Shift+方向键扩展。单格复制 TEXT 原值，多格按 TSV 复制。CSV/TSV 使用引号和双引号转义，NULL 输出为未加引号的 `NULL`，空字符串和字面量 `NULL` 加引号，BLOB 输出为 `X'…'`。最多复制或导出 10,000 个已缓存单元格、4 MiB。选区含部分值时拒绝导出并提示用 SQL 选取较小片段。
- 保存由 Tauri 原生文件对话框选择位置，Rust 校验扩展名并在目标目录原子创建新文件。已存在的文件会保留。前端没有可指定任意保存路径的命令。

## 依赖

AG Grid Community 与 React 封装固定为 36.3.0，均为 MIT，兼容 React 19。使用 Infinite Row Model、列宽及工具提示等 Community 模块。矩形选区、复制与保存由应用实现。Rust 使用 `tempfile` 3.27.0（MIT 或 Apache-2.0）保存临时结果及原子导出，使用已在锁文件中的 `serde_json`（MIT 或 Apache-2.0）编码逐行结果。发布时保留适用的第三方许可声明。 [AG Grid 发布记录](https://www.ag-grid.com/whats-new/) · [React 兼容性](https://www.ag-grid.com/react-data-grid/compatibility/)
