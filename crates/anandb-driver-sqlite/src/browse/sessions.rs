use super::{BrowseError, BrowseErrorKind, ResultInfo, Session, Source};
use std::collections::BTreeMap;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::time::{Duration, Instant};

const MAX_TABLE_SESSIONS: usize = 32;
const MAX_QUERY_SESSIONS: usize = 4;
const SNAPSHOT_IDLE: Duration = Duration::from_secs(30 * 60);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub(crate) struct Sessions {
    entries: BTreeMap<u64, Entry>,
}

struct Entry {
    session: Arc<Session>,
    last_used: Instant,
}

impl Sessions {
    pub fn expire_snapshots(&mut self) {
        self.entries.retain(|_, entry| {
            !matches!(entry.session.source, Source::Snapshot(_))
                || entry.last_used.elapsed() < SNAPSHOT_IDLE
        });
    }

    pub fn insert(
        &mut self,
        columns: Vec<String>,
        source: Source,
    ) -> Result<ResultInfo, BrowseError> {
        self.expire_snapshots();
        let snapshot = matches!(source, Source::Snapshot(_));
        let existing = self
            .entries
            .iter()
            .filter(|(_, entry)| matches!(entry.session.source, Source::Snapshot(_)) == snapshot);
        let limit = if snapshot {
            MAX_QUERY_SESSIONS
        } else {
            MAX_TABLE_SESSIONS
        };
        if existing.clone().count() >= limit {
            if !snapshot {
                return Err(BrowseError::new(
                    BrowseErrorKind::Busy,
                    "Close an open table tab before opening another",
                ));
            }
            if let Some((&id, _)) = existing.min_by_key(|(_, entry)| entry.last_used) {
                self.remove(id);
            }
        }
        let id = NEXT_ID
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
            .map_err(|_| BrowseError::failed("Result identifiers exhausted"))?;
        let session = Session::new(id.to_string(), columns, source)?;
        let info = session.info.clone();
        self.entries.insert(
            id,
            Entry {
                session: Arc::new(session),
                last_used: Instant::now(),
            },
        );
        Ok(info)
    }

    pub fn get(&mut self, id: u64) -> Result<Arc<Session>, BrowseError> {
        self.expire_snapshots();
        let entry = self.entries.get_mut(&id).ok_or_else(BrowseError::expired)?;
        entry.last_used = Instant::now();
        Ok(Arc::clone(&entry.session))
    }

    pub fn remove(&mut self, id: u64) {
        if let Some(entry) = self.entries.remove(&id) {
            entry.session.cancelled.store(true, Ordering::Relaxed);
        }
    }

    pub fn clear(&mut self) {
        for (_, entry) in std::mem::take(&mut self.entries) {
            entry.session.cancelled.store(true, Ordering::Relaxed);
        }
    }
}
