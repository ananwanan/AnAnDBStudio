use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Seek, SeekFrom, Write};

use super::{BrowseCell, BrowseError, Page, read_row};

const MAX_SNAPSHOT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SNAPSHOT_ROWS: usize = 1_000_000;
const INDEX_STRIDE: usize = 32;

pub(crate) struct SnapshotWriter {
    file: BufWriter<File>,
    offsets: Vec<u64>,
    bytes: u64,
    rows: usize,
    buffer: Vec<u8>,
}

pub(crate) struct Snapshot {
    file: File,
    offsets: Vec<u64>,
    rows: usize,
}

fn io_error(_: impl std::fmt::Display) -> BrowseError {
    BrowseError::failed("Unable to store or read the temporary query result")
}

impl SnapshotWriter {
    pub fn new() -> Result<Self, BrowseError> {
        Ok(Self {
            file: BufWriter::new(tempfile::tempfile().map_err(io_error)?),
            offsets: vec![],
            bytes: 0,
            rows: 0,
            buffer: vec![],
        })
    }

    pub fn push(&mut self, row: &rusqlite::Row<'_>, width: usize) -> Result<(), BrowseError> {
        self.buffer.clear();
        serde_json::to_writer(&mut self.buffer, &read_row(row, width)?).map_err(io_error)?;
        self.buffer.push(b'\n');
        if self.rows == MAX_SNAPSHOT_ROWS
            || self.bytes + self.buffer.len() as u64 > MAX_SNAPSHOT_BYTES
        {
            return Err(BrowseError::failed(
                "Full result exceeds the temporary result limit (64 MiB or 1,000,000 rows); add LIMIT or narrow the query",
            ));
        }
        if self.rows.is_multiple_of(INDEX_STRIDE) {
            self.offsets.push(self.bytes);
        }
        self.file.write_all(&self.buffer).map_err(io_error)?;
        self.bytes += self.buffer.len() as u64;
        self.rows += 1;
        Ok(())
    }

    pub fn finish(self) -> Result<super::Source, BrowseError> {
        Ok(super::Source::Snapshot(Snapshot {
            file: self.file.into_inner().map_err(io_error)?,
            offsets: self.offsets,
            rows: self.rows,
        }))
    }
}

impl Snapshot {
    pub fn len(&self) -> usize {
        self.rows
    }

    pub fn page(
        &self,
        offset: usize,
        limit: usize,
        check: &impl Fn() -> Result<(), BrowseError>,
    ) -> Result<Page, BrowseError> {
        if offset > self.rows {
            return Err(BrowseError::invalid("Page starts beyond the query result"));
        }
        let end = (offset + limit).min(self.rows);
        let mut rows = Vec::with_capacity(end - offset);
        if offset < end {
            // Page reads are serialized by the owning connection worker.
            let mut file = &self.file;
            let block = offset / INDEX_STRIDE;
            file.seek(SeekFrom::Start(self.offsets[block]))
                .map_err(io_error)?;
            let mut reader = BufReader::new(file);
            let mut line = Vec::new();
            for index in block * INDEX_STRIDE..end {
                check()?;
                line.clear();
                reader.read_until(b'\n', &mut line).map_err(io_error)?;
                if index >= offset {
                    rows.push(serde_json::from_slice::<Vec<BrowseCell>>(&line).map_err(io_error)?);
                }
            }
        }
        Ok(Page {
            rows,
            end: end == self.rows,
        })
    }
}
