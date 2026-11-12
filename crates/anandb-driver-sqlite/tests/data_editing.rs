use anandb_driver_sqlite::{
    OpenMode, SqliteDatabase,
    browse::{
        BrowseCell as Cell, BrowseError, BrowseErrorKind as Kind, Filter, FilterOperator,
        FilterValue, ResultInfo, TableRequest,
    },
    edit::{Change, ColumnValue, EditRequest, EditResult, OriginalRow},
    worker::ConnectionWorker,
};
use rusqlite::Connection;
use std::path::PathBuf;
use std::time::{Duration, Instant};

struct Fixture {
    _dir: tempfile::TempDir,
    path: PathBuf,
    db: Connection,
}

impl Fixture {
    fn new(sql: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("edits.sqlite");
        let db = Connection::open(&path).unwrap();
        db.execute_batch(sql).unwrap();
        Self {
            _dir: dir,
            path,
            db,
        }
    }

    fn worker(&self, mode: OpenMode) -> ConnectionWorker {
        ConnectionWorker::new(SqliteDatabase::open_existing(&self.path, mode).unwrap()).unwrap()
    }

    fn count(&self, table: &str) -> i64 {
        self.db
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
    }
}

fn open(worker: &ConnectionWorker, name: &str) -> ResultInfo {
    worker
        .open_table(
            TableRequest {
                schema: "main".into(),
                table: name.into(),
                sort: None,
                filter: None,
            },
            5000,
        )
        .unwrap()
}

fn originals(worker: &ConnectionWorker, info: &ResultInfo) -> Vec<OriginalRow> {
    let page = worker.result_page(&info.id, 0, 10, 5000).unwrap();
    page.rows
        .into_iter()
        .enumerate()
        .map(|(index, cells)| OriginalRow {
            cells,
            row_id: page.row_ids.as_ref().map(|ids| ids[index].clone()),
        })
        .collect()
}

fn batch(info: &ResultInfo, changes: Vec<Change>) -> EditRequest {
    EditRequest {
        schema_version: info.editing.as_ref().unwrap().schema_version,
        changes,
    }
}

fn save(
    worker: &ConnectionWorker,
    info: &ResultInfo,
    changes: Vec<Change>,
) -> Result<EditResult, BrowseError> {
    worker.commit_edit(&info.id, "save".into(), batch(info, changes), 5000)
}

fn text(value: &str) -> Cell {
    Cell::Text {
        value: value.into(),
    }
}
fn int(value: i64) -> Cell {
    Cell::Integer {
        value: value.to_string(),
    }
}
fn blob(value: &str) -> Cell {
    Cell::Blob {
        value: value.into(),
    }
}

fn values(entries: impl IntoIterator<Item = (usize, Cell)>) -> Vec<ColumnValue> {
    entries
        .into_iter()
        .map(|(column, value)| ColumnValue { column, value })
        .collect()
}

fn update(target: OriginalRow, entries: impl IntoIterator<Item = (usize, Cell)>) -> Change {
    Change::Update {
        target,
        values: values(entries),
    }
}

fn insert(entries: impl IntoIterator<Item = (usize, Cell)>) -> Change {
    Change::Insert {
        values: values(entries),
    }
}

fn execute(worker: &ConnectionWorker, sql: &str) {
    let job = worker.start(sql.into(), 5000, false).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(result) = worker.poll(&job).unwrap().result {
            assert_eq!(result.status, "completed", "{:?}", result.error);
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn commits_mixed_batch_with_defaults_full_types_and_trigger_effects() {
    let fixture = Fixture::new(
        r#"
        CREATE TABLE t(id INTEGER PRIMARY KEY AUTOINCREMENT, v ANY DEFAULT '默认', note TEXT,
            bits BLOB, r REAL, g TEXT GENERATED ALWAYS AS (typeof(v))) STRICT;
        CREATE TABLE audit(kind TEXT);
        CREATE TRIGGER audit_insert AFTER INSERT ON t BEGIN INSERT INTO audit VALUES('insert'); END;
        CREATE TRIGGER audit_update AFTER UPDATE ON t BEGIN INSERT INTO audit VALUES('update'); END;
        CREATE TRIGGER audit_delete AFTER DELETE ON t BEGIN INSERT INTO audit VALUES('delete'); END;
        INSERT INTO t(id, v, note, bits, r) VALUES(1, NULL, '', x'00ff', 1.25), (2, 22, '猫', NULL, 5);
    "#,
    );
    let worker = fixture.worker(OpenMode::ReadWrite);
    let info = open(&worker, "t");
    assert_eq!(info.editing.as_ref().unwrap().identity_columns, [0]);
    assert!(!info.editing.as_ref().unwrap().writable[5]);
    let mut rows = originals(&worker, &info).into_iter();
    let first = rows.next().unwrap();
    assert_eq!(
        first.cells,
        [
            int(1),
            Cell::Null,
            text(""),
            blob("00ff"),
            Cell::Real {
                value: "1.25".into()
            },
            text("null")
        ]
    );
    let second = rows.next().unwrap();
    assert_eq!(fixture.count("t"), 2);
    execute(&worker, "PRAGMA count_changes=ON");
    let outcome = save(
        &worker,
        &info,
        vec![
            update(
                first,
                [
                    (0, int(i64::MIN)),
                    (1, int(i64::MAX)),
                    (2, Cell::Null),
                    (3, blob("abcd")),
                    (
                        4,
                        Cell::Real {
                            value: "-3.5".into(),
                        },
                    ),
                ],
            ),
            Change::Delete { target: second },
            insert([]),
        ],
    )
    .unwrap();
    assert_eq!(
        (outcome.inserted, outcome.updated, outcome.deleted),
        (1, 1, 1)
    );
    let rows = originals(&worker, &info);
    assert_eq!(
        rows[0].cells,
        [
            int(i64::MIN),
            int(i64::MAX),
            Cell::Null,
            blob("abcd"),
            Cell::Real {
                value: "-3.5".into()
            },
            text("integer")
        ]
    );
    assert_eq!(rows[1].cells[..3], [int(3), text("默认"), Cell::Null]);
    assert_eq!(fixture.count("audit"), 5);
}

#[test]
fn resolves_composite_collations_and_shadowed_rowids_without_using_offsets() {
    let fixture = Fixture::new(
        r#"
        CREATE TABLE "odd ""表" ("a" TEXT COLLATE NOCASE, b INTEGER, val, PRIMARY KEY(a COLLATE BINARY, b DESC)) WITHOUT ROWID;
        INSERT INTO "odd ""表" VALUES('A', 7, 10), ('a', 7, 20);
        CREATE TABLE heap(rowid TEXT, _RoWiD_ TEXT, payload);
        INSERT INTO heap(oid, payload) VALUES(9223372036854775807, 'first'), (-7, 'second');
        CREATE TABLE shadow(rowid, _rowid_, oid, "primary key" INTEGER PRIMARY KEY);
        INSERT INTO shadow VALUES('rowid','_rowid_','oid',11);
        CREATE TABLE unavailable(rowid, _rowid_, oid, val);
        CREATE TABLE nullable(rowid, _rowid_, oid, key TEXT PRIMARY KEY);
        CREATE TABLE fallback(rowid, _rowid_, oid, key TEXT NOT NULL PRIMARY KEY);
        INSERT INTO fallback VALUES (1, 2, 3, 'key');
        CREATE VIEW v AS SELECT * FROM heap;
    "#,
    );
    let worker = fixture.worker(OpenMode::ReadWrite);
    let composite = open(&worker, "odd \"表");
    let mut rows = originals(&worker, &composite).into_iter();
    assert_eq!(composite.editing.as_ref().unwrap().identity_columns, [0, 1]);
    let first = rows.next().unwrap();
    assert_eq!(first.cells[0], text("A"));
    save(
        &worker,
        &composite,
        vec![update(first, [(0, text("猫")), (2, int(30))])],
    )
    .unwrap();
    assert_eq!(
        originals(&worker, &composite)[0].cells,
        [text("a"), int(7), int(20)]
    );
    let heap = open(&worker, "heap");
    assert_eq!(
        heap.editing.as_ref().unwrap().row_id_alias.as_deref(),
        Some("oid")
    );
    let last = originals(&worker, &heap).pop().unwrap();
    assert_eq!(last.row_id.as_deref(), Some("9223372036854775807"));
    save(&worker, &heap, vec![Change::Delete { target: last }]).unwrap();
    assert_eq!(originals(&worker, &heap)[0].cells[2], text("second"));
    let shadow = open(&worker, "shadow");
    assert_eq!(shadow.editing.as_ref().unwrap().identity_columns, [3]);
    let row = originals(&worker, &shadow).pop().unwrap();
    save(&worker, &shadow, vec![update(row, [(3, int(12))])]).unwrap();
    assert_eq!(originals(&worker, &shadow)[0].cells[3], int(12));
    let fallback = open(&worker, "fallback");
    assert_eq!(fallback.editing.as_ref().unwrap().identity_columns, [3]);
    for name in ["unavailable", "nullable"] {
        let table = open(&worker, name);
        assert_eq!(
            table.editing.as_ref().unwrap().read_only_reason,
            Some("identity")
        );
        assert_eq!(
            save(&worker, &table, vec![insert([])]).unwrap_err().kind,
            Kind::EditReadOnly
        );
    }
    let request = TableRequest {
        schema: "main".into(),
        table: "v".into(),
        sort: None,
        filter: None,
    };
    assert_eq!(
        worker.open_table(request, 5000).unwrap_err().kind,
        Kind::Invalid
    );
}

#[test]
fn rejects_constraint_generated_preview_and_ignored_writes_atomically() {
    let fixture = Fixture::new(
        r#"
        CREATE TABLE parent(id INTEGER PRIMARY KEY);
        INSERT INTO parent VALUES(1);
        CREATE TABLE t(id INTEGER PRIMARY KEY, label TEXT NOT NULL UNIQUE ON CONFLICT REPLACE,
            n INTEGER CHECK(n>0), parent INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED,
            g TEXT AS (label || '!')) STRICT;
        CREATE TRIGGER ignore_t BEFORE INSERT ON t WHEN new.label='ignored' BEGIN SELECT RAISE(IGNORE); END;
        INSERT INTO t VALUES(1,'seed',2,1);
        INSERT INTO t VALUES(2,hex(zeroblob(10000)),2,1);
    "#,
    );
    let worker = fixture.worker(OpenMode::ReadWrite);
    execute(
        &worker,
        "PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON",
    );
    let info = open(&worker, "t");
    let preview = originals(&worker, &info).pop().unwrap();
    assert!(matches!(preview.cells[1], Cell::TextPreview { .. }));
    let invalid = [
        (insert([(1, Cell::Null)]), Kind::EditConstraint),
        (insert([(1, text("seed"))]), Kind::EditConstraint),
        (
            insert([(1, text("check")), (2, int(0))]),
            Kind::EditConstraint,
        ),
        (
            insert([(1, text("fk")), (3, int(99))]),
            Kind::EditConstraint,
        ),
        (
            insert([(1, text("strict")), (2, blob("ab"))]),
            Kind::EditConstraint,
        ),
        (
            insert([(1, text("generated")), (4, text("cannot"))]),
            Kind::Invalid,
        ),
        (insert([(1, text("ignored"))]), Kind::EditAffectedRows),
        (update(preview, [(2, int(20))]), Kind::Invalid),
    ];
    for (bad, kind) in invalid {
        let failure = save(
            &worker,
            &info,
            vec![insert([(1, text("valid")), (2, int(4))]), bad],
        )
        .unwrap_err();
        assert_eq!(failure.kind, kind, "{}", failure.message);
        assert_eq!(fixture.count("t"), 2);
    }
    // The SQL editor retains its independent PRAGMA settings.
    execute(&worker, "INSERT INTO t VALUES(3,'sql',0,999)");
    assert_eq!(fixture.count("t"), 3);
}

#[test]
fn rejects_conflicts_ddl_and_database_lock_without_partial_writes() {
    let fixture = Fixture::new(
        "PRAGMA journal_mode=WAL; CREATE TABLE t(k INTEGER PRIMARY KEY,v,b);
        INSERT INTO t VALUES(1,'a',x'0001'),(2,'b',x'0203'),(3,NULL,x'04');",
    );
    let worker = fixture.worker(OpenMode::ReadWrite);
    let other = fixture.worker(OpenMode::ReadWrite);
    let info = open(&worker, "t");
    let mut rows = originals(&worker, &info).into_iter();
    let first = rows.next().unwrap();
    let second = rows.next().unwrap();
    let third = rows.next().unwrap();
    execute(
        &other,
        "UPDATE t SET b=x'0299' WHERE k=2; DELETE FROM t WHERE k=3",
    );
    let error = save(
        &worker,
        &info,
        vec![
            update(first, [(1, text("must roll back"))]),
            Change::Delete { target: second },
        ],
    )
    .unwrap_err();
    assert_eq!(error.kind, Kind::EditRowChanged);
    assert_eq!(originals(&worker, &info)[0].cells[1], text("a"));
    assert_eq!(
        save(&worker, &info, vec![Change::Delete { target: third }])
            .unwrap_err()
            .kind,
        Kind::EditRowMissing
    );
    fixture.db.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert_eq!(
        save(&worker, &info, vec![insert([])]).unwrap_err().kind,
        Kind::EditBusy
    );
    fixture
        .db
        .execute_batch("ROLLBACK; ALTER TABLE t ADD COLUMN extra")
        .unwrap();
    assert_eq!(
        save(&worker, &info, vec![insert([])]).unwrap_err().kind,
        Kind::EditSchemaChanged
    );
    let fresh = open(&worker, "t");
    assert_eq!(
        worker
            .commit_edit(
                &fresh.id,
                "old-schema".into(),
                batch(&info, vec![insert([])]),
                5000
            )
            .unwrap_err()
            .kind,
        Kind::EditSchemaChanged
    );
    assert_eq!(fixture.count("t"), 2);
}

#[test]
fn isolates_sessions_and_refuses_read_only_and_open_sql_transactions() {
    let fixture = Fixture::new("CREATE TABLE t(x);");
    let worker = fixture.worker(OpenMode::ReadWrite);
    let ro = fixture.worker(OpenMode::ReadOnly);
    let info = open(&worker, "t");
    let ro_info = open(&ro, "t");
    assert_eq!(
        ro_info.editing.as_ref().unwrap().read_only_reason,
        Some("connection")
    );
    assert_eq!(
        save(&ro, &info, vec![insert([])]).unwrap_err().kind,
        Kind::Expired
    );
    assert_eq!(
        save(&ro, &ro_info, vec![insert([])]).unwrap_err().kind,
        Kind::EditReadOnly
    );
    execute(&worker, "PRAGMA query_only=ON");
    assert_eq!(
        save(&worker, &info, vec![insert([])]).unwrap_err().kind,
        Kind::EditReadOnly
    );
    execute(
        &worker,
        "PRAGMA query_only=OFF; BEGIN; INSERT INTO t VALUES(42)",
    );
    assert_eq!(
        save(&worker, &info, vec![insert([])]).unwrap_err().kind,
        Kind::EditTransactionOpen
    );
    assert_eq!(fixture.count("t"), 0);
    execute(&worker, "ROLLBACK");
    worker.close().unwrap();
    assert_eq!(
        save(&worker, &info, vec![insert([])]).unwrap_err().kind,
        Kind::Expired
    );
}

#[test]
fn cancellation_timeout_and_connection_close_leave_no_partial_batch() {
    let fixture = Fixture::new(
        r#"
        CREATE TABLE t(x);
        CREATE TRIGGER slow BEFORE INSERT ON t WHEN new.x=2 BEGIN
            SELECT sum(n) FROM (WITH RECURSIVE c(n) AS
              (VALUES(1) UNION ALL SELECT n+1 FROM c WHERE n<100000000) SELECT n FROM c);
        END;
    "#,
    );
    let worker = fixture.worker(OpenMode::ReadWrite);
    let info = open(&worker, "t");
    let changes = || batch(&info, vec![insert([(0, int(1))]), insert([(0, int(2))])]);
    worker.cancel_edit("early").unwrap();
    assert_eq!(
        worker
            .commit_edit(&info.id, "early".into(), changes(), 5000)
            .unwrap_err()
            .kind,
        Kind::Cancelled
    );
    assert_eq!(
        worker
            .commit_edit(&info.id, "timeout".into(), changes(), 50)
            .unwrap_err()
            .kind,
        Kind::TimedOut
    );
    assert_eq!(fixture.count("t"), 0);
    for close in [false, true] {
        std::thread::scope(|scope| {
            let job =
                scope.spawn(|| worker.commit_edit(&info.id, "interrupt".into(), changes(), 5000));
            let deadline = Instant::now() + Duration::from_secs(2);
            while worker.result_page(&info.id, 0, 1, 1000).is_ok() {
                assert!(Instant::now() < deadline);
            }
            if close {
                worker.close().unwrap();
            } else {
                worker.cancel_edit("interrupt").unwrap();
            }
            assert_eq!(job.join().unwrap().unwrap_err().kind, Kind::Cancelled);
        });
        assert_eq!(fixture.count("t"), 0);
    }
}

#[test]
fn maximum_width_tables_remain_browsable_and_post_commit_count_respects_filter() {
    let fixture = Fixture::new("CREATE TABLE t(x); INSERT INTO t VALUES(1),(2),(2);");
    let max_columns = fixture
        .db
        .limit(rusqlite::limits::Limit::SQLITE_LIMIT_COLUMN)
        .unwrap();
    let columns = (0..max_columns)
        .map(|index| format!("c{index}"))
        .collect::<Vec<_>>();
    fixture
        .db
        .execute_batch(&format!(
            "CREATE TABLE wide({}); INSERT INTO wide DEFAULT VALUES;",
            columns.join(",")
        ))
        .unwrap();
    let worker = fixture.worker(OpenMode::ReadWrite);
    let wide = open(&worker, "wide");
    assert_eq!(
        wide.editing.as_ref().unwrap().read_only_reason,
        Some("width")
    );
    assert_eq!(
        worker.result_page(&wide.id, 0, 1, 5000).unwrap().rows[0].len(),
        columns.len()
    );
    let info = open(&worker, "t");
    save(&worker, &info, vec![insert([(0, int(2))])]).unwrap();
    let count = worker
        .open_table_counting(
            TableRequest {
                schema: "main".into(),
                table: "t".into(),
                sort: None,
                filter: Some(Filter {
                    column: "x".into(),
                    operator: FilterOperator::Eq,
                    value: Some(FilterValue::Integer("2".into())),
                }),
            },
            5000,
            true,
        )
        .unwrap();
    assert_eq!(count.observed_row_count, Some(3));
    assert_eq!(count.row_count, None);
}
