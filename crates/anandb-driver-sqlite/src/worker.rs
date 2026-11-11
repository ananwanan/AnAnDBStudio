//! One owning thread per SQLite connection, with one bounded result slot.
use crate::{
    SchemaSnapshot, SqliteDatabase, SqliteError,
    query::{self, QueryResult},
};
use serde::Serialize;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc,
};

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
}
enum Request {
    Query(String, u64),
    Schema(mpsc::SyncSender<Result<SchemaSnapshot, SqliteError>>),
    Close(Option<mpsc::SyncSender<Result<(), String>>>),
}
pub struct ConnectionWorker {
    sender: mpsc::Sender<Request>,
    state: Arc<Mutex<State>>,
    cancel: Arc<AtomicBool>,
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
        }));
        let cancel = Arc::new(AtomicBool::new(false));
        let thread_state = Arc::clone(&state);
        let thread_cancel = Arc::clone(&cancel);
        std::thread::Builder::new()
            .name("sqlite-worker".into())
            .spawn(move || {
                while let Ok(request) = receiver.recv() {
                    match request {
                        Request::Query(sql, timeout) => {
                            let result = query::execute(
                                &mut database.connection,
                                &sql,
                                Arc::clone(&thread_cancel),
                                timeout,
                            );
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
        })
    }
    pub fn start(&self, sql: String, timeout_ms: u64) -> Result<String, String> {
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
        if self.sender.send(Request::Query(sql, timeout_ms)).is_err() {
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
            self.cancel.store(true, Ordering::Relaxed);
            self.sender
                .send(Request::Close(Some(sender)))
                .map_err(|_| "Worker stopped")?;
        }
        receiver.recv().map_err(|_| "Worker stopped")?
    }
}
fn schema_worker_error(message: &str) -> SqliteError {
    SqliteError::Io(std::io::Error::other(message))
}

impl Drop for ConnectionWorker {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
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
        let id = w.start("WITH RECURSIVE a(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM a) SELECT sum(x) FROM a".into(), 5000).unwrap();
        assert!(w.start("SELECT 1".into(), 5000).is_err());
        assert!(w.schema().is_err());
        let other = worker();
        assert!(other.schema().is_ok());
        assert!(w.cancel("999").is_err());
        w.cancel(&id).unwrap();
        assert_eq!(wait(&w, &id).status, "cancelled");
        let next = w.start("SELECT 42".into(), 5000).unwrap();
        assert!(w.cancel(&id).is_err());
        assert_eq!(wait(&w, &next).status, "completed");
        w.close().unwrap();
        assert!(w.start("SELECT 1".into(), 5000).is_err());
    }
    #[test]
    fn close_interrupts_running_query() {
        let w = worker();
        w.start(
            "WITH RECURSIVE a(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM a) SELECT sum(x) FROM a"
                .into(),
            300000,
        )
        .unwrap();
        let now = Instant::now();
        w.close().unwrap();
        assert!(now.elapsed() < Duration::from_secs(2));
    }
}
