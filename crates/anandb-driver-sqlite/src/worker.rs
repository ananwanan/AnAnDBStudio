//! One owning thread per SQLite connection, with one bounded result slot.
use crate::{
    SchemaSnapshot, SqliteDatabase, SqliteError,
    browse::{
        self, BrowseError, BrowseErrorKind, Page, ResultInfo, Sessions, Source, Table, TableRequest,
    },
    query::{self, QueryResult},
};
use serde::Serialize;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::Duration;

const MAX_BROWSE_REQUESTS: usize = 8;
type BrowseTask = Box<dyn FnOnce(&mut rusqlite::Connection) + Send>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub id: String,
    pub result: Option<QueryResult>,
}
struct State {
    busy: bool,
    closed: bool,
    sequence: u64,
    job: Option<JobSnapshot>,
    browse_requests: usize,
}
enum Request {
    Query(String, u64, bool),
    Schema(mpsc::SyncSender<Result<SchemaSnapshot, SqliteError>>),
    Browse(BrowseTask),
    Close(Option<mpsc::SyncSender<Result<(), String>>>),
}
pub struct ConnectionWorker {
    sender: mpsc::Sender<Request>,
    state: Arc<Mutex<State>>,
    cancel: Arc<AtomicBool>,
    closed: Arc<AtomicBool>,
    sessions: Arc<Mutex<Sessions>>,
}
impl ConnectionWorker {
    pub fn new(mut database: SqliteDatabase) -> Result<Self, String> {
        query::configure(&mut database.connection).map_err(|e| e.to_string())?;
        let (sender, receiver) = mpsc::channel();
        let state = Arc::new(Mutex::new(State {
            busy: false,
            closed: false,
            sequence: 0,
            job: None,
            browse_requests: 0,
        }));
        let cancel = Arc::new(AtomicBool::new(false));
        let thread_state = Arc::clone(&state);
        let thread_cancel = Arc::clone(&cancel);
        let closed = Arc::new(AtomicBool::new(false));
        let thread_closed = Arc::clone(&closed);
        let sessions = Arc::new(Mutex::new(Sessions::default()));
        let thread_sessions = Arc::clone(&sessions);
        std::thread::Builder::new()
            .name("sqlite-worker".into())
            .spawn(move || {
                loop {
                    let request = match receiver.recv_timeout(Duration::from_secs(60)) {
                        Ok(request) => request,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if let Ok(mut sessions) = thread_sessions.lock() {
                                sessions.expire_snapshots();
                            }
                            continue;
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    };
                    match request {
                        Request::Query(sql, timeout, capture) => {
                            let cancel = Arc::clone(&thread_cancel);
                            let result = if capture {
                                query::execute_capturing(
                                    &mut database.connection,
                                    &sql,
                                    cancel,
                                    timeout,
                                    |columns, source| {
                                        let mut sessions = thread_sessions
                                            .lock()
                                            .map_err(|_| browse_worker_error())?;
                                        if thread_closed.load(Ordering::Relaxed) {
                                            return Err(BrowseError::expired());
                                        }
                                        sessions.insert(columns, source)
                                    },
                                )
                            } else {
                                query::execute(&mut database.connection, &sql, cancel, timeout)
                            };
                            if let Ok(mut state) = thread_state.lock() {
                                if let Some(job) = state.job.as_mut() {
                                    job.result = Some(result);
                                }
                                state.busy = false;
                            }
                        }
                        Request::Schema(reply) => {
                            let result = database.read_schema();
                            if let Ok(mut state) = thread_state.lock() {
                                state.busy = false;
                            }
                            let _ = reply.send(result);
                        }
                        Request::Browse(task) => {
                            task(&mut database.connection);
                        }
                        Request::Close(reply) => {
                            let result = database.close().map_err(|e| e.to_string());
                            if let Some(reply) = reply {
                                let _ = reply.send(result);
                            }
                            return;
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            sender,
            state,
            cancel,
            closed,
            sessions,
        })
    }
    pub fn start(&self, sql: String, timeout_ms: u64, capture: bool) -> Result<String, String> {
        if sql.trim().is_empty()
            || sql.contains('\0')
            || sql.len() > query::MAX_SQL_BYTES
            || !(1..=300_000).contains(&timeout_ms)
        {
            return Err(
                "SQL must be non-empty, at most 256 KiB; timeout must be 1–300000 ms".into(),
            );
        }
        let mut state = self.state.lock().map_err(|_| "Worker unavailable")?;
        if state.closed || state.busy {
            return Err("Connection is closed or busy".into());
        }
        state.sequence = state
            .sequence
            .checked_add(1)
            .ok_or("Job identifiers exhausted")?;
        let id = state.sequence.to_string();
        self.cancel.store(false, Ordering::Relaxed);
        state.job = Some(JobSnapshot {
            id: id.clone(),
            result: None,
        });
        state.busy = true;
        if self
            .sender
            .send(Request::Query(sql, timeout_ms, capture))
            .is_err()
        {
            state.busy = false;
            return Err("Worker stopped".into());
        }
        Ok(id)
    }
    pub fn poll(&self, id: &str) -> Result<JobSnapshot, String> {
        self.state
            .lock()
            .map_err(|_| "Worker unavailable")?
            .job
            .as_ref()
            .filter(|job| job.id == id)
            .cloned()
            .ok_or_else(|| "Query job no longer exists".into())
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let state = self.state.lock().map_err(|_| "Worker unavailable")?;
        match &state.job {
            Some(job) if job.id == id => {
                if job.result.is_none() {
                    self.cancel.store(true, Ordering::Relaxed);
                }
                Ok(())
            }
            _ => Err("Query job no longer exists".into()),
        }
    }
    pub fn schema(&self) -> Result<SchemaSnapshot, SqliteError> {
        let (sender, receiver) = mpsc::sync_channel(1);
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| schema_worker_error("Worker unavailable"))?;
            if state.closed || state.busy {
                return Err(schema_worker_error("Connection is closed or busy"));
            }
            state.busy = true;
            if self.sender.send(Request::Schema(sender)).is_err() {
                state.busy = false;
                return Err(schema_worker_error("Worker stopped"));
            }
        }
        receiver
            .recv()
            .map_err(|_| schema_worker_error("Worker stopped"))?
    }
    pub fn close(&self) -> Result<(), String> {
        let (sender, receiver) = mpsc::sync_channel(1);
        {
            let mut state = self.state.lock().map_err(|_| "Worker unavailable")?;
            if state.closed {
                return Err("Connection already closed".into());
            }
            state.closed = true;
            self.closed.store(true, Ordering::Relaxed);
            self.cancel.store(true, Ordering::Relaxed);
            if let Ok(mut sessions) = self.sessions.lock() {
                sessions.clear();
            }
            self.sender
                .send(Request::Close(Some(sender)))
                .map_err(|_| "Worker stopped")?;
        }
        receiver.recv().map_err(|_| "Worker stopped")?
    }

    pub fn open_table(
        &self,
        request: TableRequest,
        timeout_ms: u64,
    ) -> Result<ResultInfo, BrowseError> {
        let deadline = browse::deadline(timeout_ms)?;
        let sessions = Arc::clone(&self.sessions);
        let closed = Arc::clone(&self.closed);
        self.browse(move |connection| {
            let (table, columns) =
                browse::read_table(connection, deadline, &closed, &closed, |connection| {
                    Table::open(connection, request)
                })?;
            let mut sessions = sessions.lock().map_err(|_| browse_worker_error())?;
            browse::check_operation(deadline, &closed, &closed)?;
            sessions.insert(columns, Source::Table(table))
        })
    }

    pub fn result_page(
        &self,
        id: &str,
        offset: usize,
        limit: usize,
        timeout_ms: u64,
    ) -> Result<Page, BrowseError> {
        let deadline = browse::deadline(timeout_ms)?;
        let id = result_id(id)?;
        let session = self
            .sessions
            .lock()
            .map_err(|_| browse_worker_error())?
            .get(id)?;
        let closed = Arc::clone(&self.closed);
        let sessions = Arc::clone(&self.sessions);
        self.browse(move |connection| {
            let result = session.page(connection, offset, limit, deadline, &closed);
            if let Err(error) = &result
                && matches!(
                    error.kind,
                    BrowseErrorKind::Failed | BrowseErrorKind::Expired | BrowseErrorKind::TimedOut
                )
            {
                sessions
                    .lock()
                    .map_err(|_| browse_worker_error())?
                    .remove(id);
            }
            result
        })
    }

    pub fn close_result(&self, id: &str) -> Result<(), BrowseError> {
        self.sessions
            .lock()
            .map_err(|_| browse_worker_error())?
            .remove(result_id(id)?);
        Ok(())
    }

    fn browse<T: Send + 'static>(
        &self,
        run: impl FnOnce(&mut rusqlite::Connection) -> Result<T, BrowseError> + Send + 'static,
    ) -> Result<T, BrowseError> {
        let (reply, receiver) = mpsc::sync_channel(1);
        {
            let mut state = self.state.lock().map_err(|_| browse_worker_error())?;
            if state.closed {
                return Err(BrowseError::expired());
            }
            if state.busy || state.browse_requests >= MAX_BROWSE_REQUESTS {
                return Err(BrowseError::new(
                    BrowseErrorKind::Busy,
                    "SQLite connection is busy",
                ));
            }
            let shared = Arc::clone(&self.state);
            let task = move |connection: &mut rusqlite::Connection| {
                let result = run(connection);
                if let Ok(mut state) = shared.lock() {
                    state.browse_requests -= 1;
                }
                let _ = reply.send(result);
            };
            self.sender
                .send(Request::Browse(Box::new(task)))
                .map_err(|_| browse_worker_error())?;
            state.browse_requests += 1;
        }
        receiver.recv().map_err(|_| browse_worker_error())?
    }
}

fn result_id(id: &str) -> Result<u64, BrowseError> {
    id.parse()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(|| BrowseError::invalid("Invalid result session identifier"))
}

fn browse_worker_error() -> BrowseError {
    BrowseError::failed("SQLite connection worker unavailable")
}
fn schema_worker_error(message: &str) -> SqliteError {
    SqliteError::Io(std::io::Error::other(message))
}

impl Drop for ConnectionWorker {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::Relaxed);
        self.cancel.store(true, Ordering::Relaxed);
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
        let _ = self.sender.send(Request::Close(None));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::OpenMode;
    use std::time::{Duration, Instant};
    fn worker() -> ConnectionWorker {
        ConnectionWorker::new(SqliteDatabase {
            connection: rusqlite::Connection::open_in_memory().unwrap(),
            path: Default::default(),
            mode: OpenMode::ReadWrite,
        })
        .unwrap()
    }
    fn wait(w: &ConnectionWorker, id: &str) -> QueryResult {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(r) = w.poll(id).unwrap().result {
                return r;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    #[test]
    fn jobs_are_serialized_cancellable_and_other_connections_stay_responsive() {
        let w = worker();
        let id = w.start("WITH RECURSIVE a(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM a) SELECT sum(x) FROM a".into(), 5000, false).unwrap();
        assert!(w.start("SELECT 1".into(), 5000, false).is_err());
        assert!(w.schema().is_err());
        let other = worker();
        assert!(other.schema().is_ok());
        assert!(w.cancel("999").is_err());
        w.cancel(&id).unwrap();
        assert_eq!(wait(&w, &id).status, "cancelled");
        let next = w.start("SELECT 42".into(), 5000, false).unwrap();
        assert!(w.cancel(&id).is_err());
        assert_eq!(wait(&w, &next).status, "completed");
        w.close().unwrap();
        assert!(w.start("SELECT 1".into(), 5000, false).is_err());
    }
    #[test]
    fn close_interrupts_running_query() {
        let w = worker();
        w.start(
            "WITH RECURSIVE a(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM a) SELECT sum(x) FROM a"
                .into(),
            300000,
            false,
        )
        .unwrap();
        let now = Instant::now();
        w.close().unwrap();
        assert!(now.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn queued_result_requests_can_be_cancelled_and_timed_out() {
        let w = worker();
        let id = w
            .start(
                "CREATE TABLE t(x); INSERT INTO t VALUES(1)".into(),
                5000,
                false,
            )
            .unwrap();
        assert_eq!(wait(&w, &id).status, "completed");
        let open = || {
            w.open_table(
                TableRequest {
                    schema: "main".into(),
                    table: "t".into(),
                    sort: None,
                    filter: None,
                },
                5000,
            )
            .unwrap()
        };
        let cancelled = open();
        let timed_out = open();
        let (resume, paused) = mpsc::sync_channel(1);
        let (ready, started) = mpsc::sync_channel(1);
        assert!(
            w.sender
                .send(Request::Browse(Box::new(move |_| {
                    ready.send(()).unwrap();
                    paused.recv().unwrap();
                })))
                .is_ok()
        );
        started.recv_timeout(Duration::from_secs(2)).unwrap();
        std::thread::scope(|scope| {
            let cancel_page = scope.spawn(|| w.result_page(&cancelled.id, 0, 10, 5000));
            let timeout_page = scope.spawn(|| w.result_page(&timed_out.id, 0, 10, 1));
            let deadline = Instant::now() + Duration::from_secs(2);
            while w.state.lock().unwrap().browse_requests != 2 {
                if Instant::now() >= deadline {
                    resume.send(()).unwrap();
                    panic!("Result requests did not enter the worker queue");
                }
                std::thread::sleep(Duration::from_millis(1));
            }
            w.close_result(&cancelled.id).unwrap();
            std::thread::sleep(Duration::from_millis(10));
            resume.send(()).unwrap();
            assert_eq!(
                cancel_page.join().unwrap().unwrap_err().kind,
                BrowseErrorKind::Cancelled
            );
            assert_eq!(
                timeout_page.join().unwrap().unwrap_err().kind,
                BrowseErrorKind::TimedOut
            );
        });
        assert_eq!(
            w.result_page(&timed_out.id, 0, 1, 5000).unwrap_err().kind,
            BrowseErrorKind::Expired
        );
        let usable = open();
        assert_eq!(
            w.result_page(&usable.id, 0, 10, 5000).unwrap().rows.len(),
            1
        );
    }
}
