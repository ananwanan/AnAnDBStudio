use std::time::{Duration, Instant};

use anandb_driver_sqlite::{
    OpenMode, SqliteDatabase,
    browse::{
        BrowseCell, BrowseErrorKind, Filter, FilterOperator, FilterValue, Sort, TableRequest,
    },
    query::QueryResult,
    worker::ConnectionWorker,
};
use rusqlite::Connection;

struct Fixture {
    _dir: tempfile::TempDir,
    path: std::path::PathBuf,
    writer: Connection,
}

impl Fixture {
    fn new(sql: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.sqlite");
        let writer = Connection::open(&path).unwrap();
        writer.execute_batch(sql).unwrap();
        Self {
            _dir: dir,
            path,
            writer,
        }
    }

    fn open(&self, mode: OpenMode) -> ConnectionWorker {
        ConnectionWorker::new(SqliteDatabase::open_existing(&self.path, mode).unwrap()).unwrap()
    }
}

fn table(name: &str) -> TableRequest {
    TableRequest {
        schema: "main".into(),
        table: name.into(),
        filter: None,
        sort: None,
    }
}

fn integer(cell: &BrowseCell) -> i64 {
    match cell {
        BrowseCell::Integer { value } => value.parse().unwrap(),
        cell => panic!("Expected integer, received {cell:?}"),
    }
}

fn execute(worker: &ConnectionWorker, sql: &str, capture: bool) -> QueryResult {
    let id = worker.start(sql.into(), 30_000, capture).unwrap();
    let deadline = Instant::now() + Duration::from_secs(35);
    loop {
        if let Some(result) = worker.poll(&id).unwrap().result {
            return result;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn browses_special_names_empty_tables_and_without_rowid_with_typed_filters() {
    let fixture = Fixture::new(
        r#"
        CREATE TABLE "order ""表" ("select" TEXT COLLATE NOCASE, "键" INTEGER, value,
            PRIMARY KEY ("select" COLLATE BINARY, "键" DESC)) WITHOUT ROWID;
        INSERT INTO "order ""表" VALUES
            ('A', 2, 9223372036854775807), ('a', 2, -9223372036854775808),
            ('a', 1, NULL), ('B', 1, '9'), ('D', 1, 1.25), ('E', 1, x'00ff'), ('猫', 1, '');
        CREATE TABLE empty(x);
        CREATE VIEW v AS SELECT * FROM empty;
    "#,
    );
    let worker = fixture.open(OpenMode::ReadOnly);
    let info = worker.open_table(table("order \"表"), 5000).unwrap();
    assert_eq!(info.columns, ["select", "键", "value"]);
    let first = worker.result_page(&info.id, 0, 2, 5000).unwrap();
    assert!(!first.end);
    assert_eq!(integer(&first.rows[0][2]), i64::MAX);
    assert!(matches!(&first.rows[1][2], BrowseCell::Text { value } if value == "9"));
    let second = worker.result_page(&info.id, 4, 2, 5000).unwrap();
    assert_eq!(integer(&second.rows[0][2]), i64::MIN);
    assert!(matches!(second.rows[1][2], BrowseCell::Null));
    let middle = worker.result_page(&info.id, 2, 2, 5000).unwrap();
    assert!(matches!(&middle.rows[0][2], BrowseCell::Real { value } if value == "1.25"));
    assert!(matches!(&middle.rows[1][2], BrowseCell::Blob { value } if value == "00ff"));
    let tail = worker.result_page(&info.id, 6, 1, 5000).unwrap();
    assert!(tail.end);
    assert!(matches!(&tail.rows[0][2], BrowseCell::Text { value } if value.is_empty()));

    let mut request = table("order \"表");
    request.sort = Some(Sort {
        column: "select".into(),
        descending: true,
    });
    request.filter = Some(Filter {
        column: "value".into(),
        operator: FilterOperator::Ge,
        value: Some(FilterValue::Integer("9223372036854775807".into())),
    });
    let sorted = worker.open_table(request, 5000).unwrap();
    let result = worker.result_page(&sorted.id, 0, 10, 5000).unwrap();
    // SQLite compares by storage class for this column with no declared affinity.
    assert_eq!(result.rows.len(), 4);
    assert!(matches!(&result.rows[0][0], BrowseCell::Text { value } if value == "猫"));
    assert_eq!(integer(&result.rows[3][2]), i64::MAX);

    let mut request = table("order \"表");
    request.filter = Some(Filter {
        column: "select".into(),
        operator: FilterOperator::Eq,
        value: Some(FilterValue::Text("a' OR 1=1 --".into())),
    });
    let filtered = worker.open_table(request, 5000).unwrap();
    assert!(
        worker
            .result_page(&filtered.id, 0, 10, 5000)
            .unwrap()
            .rows
            .is_empty()
    );

    let mut request = table("order \"表");
    request.sort = Some(Sort {
        column: "\"; DROP TABLE empty;--".into(),
        descending: false,
    });
    assert_eq!(
        worker.open_table(request, 5000).unwrap_err().kind,
        BrowseErrorKind::Invalid
    );

    let empty = worker.open_table(table("empty"), 5000).unwrap();
    let result = worker.result_page(&empty.id, 0, 10, 5000).unwrap();
    assert!(result.end && result.rows.is_empty());
    for name in ["v", "missing", "sqlite_schema"] {
        assert_eq!(
            worker.open_table(table(name), 5000).unwrap_err().kind,
            BrowseErrorKind::Invalid
        );
    }
}

#[test]
fn snapshot_reads_original_join_once_and_never_replays_writes() {
    let fixture = Fixture::new("PRAGMA journal_mode=WAL; CREATE TABLE t(x);");
    let worker = fixture.open(OpenMode::ReadWrite);
    let result = execute(
        &worker,
        "
        WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<450)
        INSERT INTO t SELECT i FROM n RETURNING x;
        SELECT a.x, b.x, a.x AS random_source, zeroblob(120000) AS big
        FROM t a JOIN t b ON b.x=a.x ORDER BY a.x;
        UPDATE t SET x=x+1000;
        SELECT * FROM t LIMIT 0;
    ",
        true,
    );
    assert_eq!(result.status, "completed", "{:?}", result.error);
    assert_eq!(result.statements[0].affected_rows, "450");
    assert!(result.statements[0].full_result.is_none());
    let empty = result.statements[3].full_result.as_ref().unwrap();
    assert_eq!(empty.row_count, Some(0));
    assert!(worker.result_page(&empty.id, 0, 25, 5000).unwrap().end);
    // Each result contains a bounded prefix for large values. 450 * 24 KiB is below 64 MiB.
    let info = result.statements[1].full_result.as_ref().unwrap();
    assert_eq!(info.columns, ["x", "x", "random_source", "big"]);
    assert_eq!(info.row_count, Some(450));
    let page = worker.result_page(&info.id, 400, 50, 5000).unwrap();
    assert_eq!(integer(&page.rows[0][0]), 401);
    assert_eq!(integer(&page.rows[49][1]), 450);
    assert!(
        matches!(&page.rows[0][3], BrowseCell::BlobPreview { bytes: 120000, value } if value.len() <= 24576)
    );
    assert!(page.end);
    assert_eq!(
        fixture
            .writer
            .query_row("SELECT count(*) FROM t WHERE x >= 1001", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        450
    );
    assert_eq!(
        worker.result_page(&info.id, 451, 1, 5000).unwrap_err().kind,
        BrowseErrorKind::Invalid
    );
    assert_eq!(
        worker.result_page(&info.id, 0, 101, 5000).unwrap_err().kind,
        BrowseErrorKind::Invalid
    );

    let other = fixture.open(OpenMode::ReadOnly);
    assert_eq!(
        other.result_page(&info.id, 0, 1, 5000).unwrap_err().kind,
        BrowseErrorKind::Expired
    );
    worker.close_result(&info.id).unwrap();
    worker.close_result(&info.id).unwrap();
    assert_eq!(
        worker.result_page(&info.id, 0, 1, 5000).unwrap_err().kind,
        BrowseErrorKind::Expired
    );
    worker.close().unwrap();
    assert_eq!(
        worker.result_page(&empty.id, 0, 1, 5000).unwrap_err().kind,
        BrowseErrorKind::Expired
    );
}

#[test]
fn read_sessions_release_locks_and_expire_on_schema_changes() {
    let fixture = Fixture::new("CREATE TABLE t(x); INSERT INTO t VALUES (1);");
    let worker = fixture.open(OpenMode::ReadWrite);
    let result = worker.open_table(table("t"), 5000).unwrap();
    assert_eq!(
        integer(&worker.result_page(&result.id, 0, 1, 5000).unwrap().rows[0][0]),
        1
    );
    fixture.writer.execute("UPDATE t SET x=2", []).unwrap();
    assert_eq!(
        integer(&worker.result_page(&result.id, 0, 1, 5000).unwrap().rows[0][0]),
        2
    );

    assert!(execute(&worker, "BEGIN; UPDATE t SET x=3", false).transaction_open);
    assert_eq!(
        integer(&worker.result_page(&result.id, 0, 1, 5000).unwrap().rows[0][0]),
        3
    );
    assert!(!execute(&worker, "ROLLBACK", false).transaction_open);
    assert_eq!(
        fixture
            .writer
            .query_row("SELECT x FROM t", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        2
    );

    fixture.writer.execute("DROP TABLE t", []).unwrap();
    assert_eq!(
        worker.result_page(&result.id, 0, 1, 5000).unwrap_err().kind,
        BrowseErrorKind::Expired
    );
    assert_eq!(
        worker.result_page(&result.id, 0, 1, 5000).unwrap_err().kind,
        BrowseErrorKind::Expired
    );
}

#[test]
fn large_table_page_benchmark() {
    for size in [100_000, 1_000_000] {
        let fixture = Fixture::new(&format!(
            "
            CREATE TABLE rows(id INTEGER PRIMARY KEY, payload TEXT);
            WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<{size})
            INSERT INTO rows SELECT i, printf('row-%07d', i) FROM n;
        "
        ));
        let worker = fixture.open(OpenMode::ReadOnly);
        let info = worker.open_table(table("rows"), 5000).unwrap();
        let plan: String = fixture.writer.query_row(
            "EXPLAIN QUERY PLAN SELECT id, payload FROM main.rows ORDER BY rowid LIMIT 100 OFFSET 0",
            [], |row| row.get(3)
        ).unwrap();
        assert!(!plan.contains("TEMP B-TREE"));
        for offset in [0, 100, size - 100] {
            let mut times = Vec::new();
            let mut bytes = 0;
            for _ in 0..5 {
                let start = Instant::now();
                let page = worker.result_page(&info.id, offset, 100, 5000).unwrap();
                times.push(start.elapsed());
                assert_eq!(page.rows.len(), 100);
                assert_eq!(integer(&page.rows[0][0]), (offset + 1) as i64);
                assert_eq!(integer(&page.rows[99][0]), (offset + 100) as i64);
                assert_eq!(page.end, offset + 100 == size);
                bytes = serde_json::to_vec(&page).unwrap().len();
                assert!(bytes < 10_000);
            }
            times.sort();
            let mut stmt = fixture
                .writer
                .prepare("SELECT id, payload FROM main.rows ORDER BY rowid LIMIT ?1 OFFSET ?2")
                .unwrap();
            {
                let mut rows = stmt.query([101, offset as i64]).unwrap();
                while rows.next().unwrap().is_some() {}
            }
            let vm_steps = stmt.get_status(rusqlite::StatementStatus::VmStep);
            if offset == 0 {
                assert!(vm_steps < 2000);
            }
            println!(
                "{size} rows | offset {offset:>7} | 100 rows | {bytes} bytes | median {:.3} ms | {vm_steps} VM steps",
                times[2].as_secs_f64() * 1000.0
            );
        }
    }
}
