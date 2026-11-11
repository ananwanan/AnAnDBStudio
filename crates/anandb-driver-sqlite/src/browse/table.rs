use rusqlite::{Connection, OptionalExtension, params, types::Value};

use super::{
    BrowseError, FilterOperator, FilterValue, Page, TableRequest, read_row, validate_columns,
};

pub(crate) struct Table {
    sql: String,
    filter_value: Option<Value>,
    schema_version: i64,
}

fn identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn field(name: &str) -> String {
    format!("source.{}", identifier(name))
}

fn schema_version(connection: &Connection) -> rusqlite::Result<i64> {
    connection.query_row("PRAGMA main.schema_version", [], |row| row.get(0))
}

fn bind(value: FilterValue) -> Result<Value, BrowseError> {
    const MAX_INPUT_BYTES: usize = 16 * 1024;
    let invalid = || BrowseError::invalid("Invalid typed filter value or value exceeds 16 KiB");
    match value {
        FilterValue::Text(value) if value.len() <= MAX_INPUT_BYTES => Ok(Value::Text(value)),
        FilterValue::Integer(value) if value.len() <= 20 => value
            .parse::<i64>()
            .map(Value::Integer)
            .map_err(|_| invalid()),
        FilterValue::Real(value) if value.len() <= 64 => value
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite())
            .map(Value::Real)
            .ok_or_else(invalid),
        FilterValue::Blob(value)
            if value.len() <= MAX_INPUT_BYTES * 2 && value.len().is_multiple_of(2) =>
        {
            value
                .as_bytes()
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| {
                    let high = (pair[0] as char).to_digit(16).ok_or_else(invalid)?;
                    let low = (pair[1] as char).to_digit(16).ok_or_else(invalid)?;
                    Ok((high * 16 + low) as u8)
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Blob)
        }
        _ => Err(invalid()),
    }
}

impl Table {
    pub(crate) fn open(
        connection: &Connection,
        request: TableRequest,
    ) -> Result<(Self, Vec<String>), BrowseError> {
        let TableRequest {
            schema,
            table,
            sort,
            filter,
        } = request;
        if schema != "main"
            || table.contains('\0')
            || table.len() > 65536
            || table
                .get(..7)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("sqlite_"))
        {
            return Err(BrowseError::invalid(
                "Only ordinary tables in the main schema can be browsed",
            ));
        }

        let version = schema_version(connection)?;
        let without_rowid: Option<bool> = connection.query_row(
            "SELECT wr FROM pragma_table_list(?1) WHERE schema = 'main' AND name = ?1 AND type = 'table'",
            [&table], |row| row.get(0),
        ).optional()?;
        let Some(without_rowid) = without_rowid else {
            return Err(BrowseError::invalid(
                "The requested table is missing or is not an ordinary table",
            ));
        };

        let mut stmt = connection.prepare(
            "SELECT name, pk FROM pragma_table_xinfo(?1, 'main') WHERE hidden != 1 ORDER BY cid",
        )?;
        let mut metadata = stmt.query([&table])?;
        let mut columns = Vec::new();
        let mut primary_key = Vec::new();
        while let Some(row) = metadata.next()? {
            let name: String = row.get(0)?;
            let position: i64 = row.get(1)?;
            if position > 0 {
                primary_key.push((position, name.clone()));
            }
            columns.push(name);
        }
        validate_columns(&columns)?;

        let require_column = |column: &str| {
            if columns.iter().any(|name| name == column) {
                Ok(field(column))
            } else {
                Err(BrowseError::invalid(
                    "Sort or filter column does not exist on this table",
                ))
            }
        };
        let mut sql = format!(
            "SELECT {} FROM main.{} AS source",
            columns
                .iter()
                .map(|name| field(name))
                .collect::<Vec<_>>()
                .join(", "),
            identifier(&table),
        );
        let mut filter_value = None;
        if let Some(filter) = filter {
            let column = require_column(&filter.column)?;
            let predicate = match filter.operator {
                FilterOperator::IsNull | FilterOperator::IsNotNull => {
                    if filter.value.is_some() {
                        return Err(BrowseError::invalid("NULL tests do not take a value"));
                    }
                    let operator = if matches!(filter.operator, FilterOperator::IsNull) {
                        "IS NULL"
                    } else {
                        "IS NOT NULL"
                    };
                    format!("{column} {operator}")
                }
                operator => {
                    let value = filter
                        .value
                        .ok_or_else(|| BrowseError::invalid("Filter requires a value"))?;
                    if matches!(operator, FilterOperator::Contains | FilterOperator::Like)
                        && !matches!(value, FilterValue::Text(_))
                    {
                        return Err(BrowseError::invalid(
                            "Contains and LIKE require a TEXT filter",
                        ));
                    }
                    filter_value = Some(bind(value)?);
                    let comparison = match operator {
                        FilterOperator::Eq => "=",
                        FilterOperator::Ne => "!=",
                        FilterOperator::Gt => ">",
                        FilterOperator::Lt => "<",
                        FilterOperator::Ge => ">=",
                        FilterOperator::Le => "<=",
                        FilterOperator::Like => "LIKE",
                        FilterOperator::Contains => "",
                        FilterOperator::IsNull | FilterOperator::IsNotNull => unreachable!(),
                    };
                    if matches!(operator, FilterOperator::Contains) {
                        format!("instr({column}, ?) > 0")
                    } else {
                        format!("{column} {comparison} ?")
                    }
                }
            };
            sql.push_str(" WHERE ");
            sql.push_str(&predicate);
        }

        let mut order = Vec::new();
        if let Some(sort) = &sort {
            order.push(format!(
                "{} {}",
                require_column(&sort.column)?,
                if sort.descending { "DESC" } else { "ASC" }
            ));
        }
        if let Some(rowid) = (!without_rowid)
            .then(|| {
                ["rowid", "_rowid_", "oid"]
                    .into_iter()
                    .find(|alias| !columns.iter().any(|name| name.eq_ignore_ascii_case(alias)))
            })
            .flatten()
        {
            order.push(field(rowid));
        } else {
            primary_key.sort_by_key(|entry| entry.0);
            order.extend(primary_key.into_iter().map(|(_, name)| field(&name)));
            if !without_rowid || order.is_empty() {
                order.extend(
                    columns
                        .iter()
                        .map(|name| format!("{} COLLATE BINARY", field(name))),
                );
            } else {
                // A PRIMARY KEY may override the column's declared collation.
                // Read its actual key terms to preserve uniqueness and index order.
                let mut index = connection.prepare(
                    "SELECT x.name, x.coll, x.desc FROM pragma_index_list(?1, 'main') AS i
                     JOIN pragma_index_xinfo(i.name, 'main') AS x WHERE i.origin = 'pk' AND x.key = 1 ORDER BY x.seqno"
                )?;
                let key = index
                    .query_map([&table], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, bool>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                if !key.is_empty() {
                    order.truncate(usize::from(sort.is_some()));
                    order.extend(key.into_iter().map(|(name, collation, descending)| {
                        format!(
                            "{} COLLATE {} {}",
                            field(&name),
                            identifier(&collation),
                            if descending { "DESC" } else { "ASC" }
                        )
                    }));
                }
            }
        }
        sql.push_str(" ORDER BY ");
        sql.push_str(&order.join(", "));
        sql.push_str(" LIMIT ? OFFSET ?");
        Ok((
            Self {
                sql,
                filter_value,
                schema_version: version,
            },
            columns,
        ))
    }

    pub(crate) fn page(
        &self,
        connection: &Connection,
        offset: usize,
        limit: usize,
        columns: &[String],
        check: &impl Fn() -> Result<(), BrowseError>,
    ) -> Result<Page, BrowseError> {
        if schema_version(connection)? != self.schema_version {
            return Err(BrowseError::expired());
        }
        let mut statement = connection.prepare_cached(&self.sql)?;
        let take = limit as i64 + 1;
        let skip = offset as i64;
        let mut rows = match &self.filter_value {
            Some(value) => statement.query(params![value, take, skip])?,
            None => statement.query(params![take, skip])?,
        };
        let mut page = Page {
            rows: Vec::with_capacity(limit),
            end: true,
        };
        while let Some(row) = rows.next()? {
            check()?;
            if page.rows.len() == limit {
                page.end = false;
                break;
            }
            page.rows.push(read_row(row, columns.len())?);
        }
        Ok(page)
    }
}
