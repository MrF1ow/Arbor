use rusqlite::params;
use std::path::Path;

#[derive(Debug, serde::Serialize, Clone)]
pub struct SearchHit {
    pub course: String,
    pub path: String,
    pub kind: String,
    pub title: String,
    pub snippet: String,
    pub page_range: Option<String>,
    pub source_path: Option<String>,
}

pub fn search_documents(
    knowledge_root: &Path,
    query: &str,
    limit: u32,
) -> Result<Vec<SearchHit>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let conn = crate::db::open(knowledge_root)?;
    let fts_query = trimmed
        .split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ");
    let mut stmt = conn
        .prepare(
            "SELECT course, path, kind, title,
                    snippet(search_index, 4, '', '', '…', 48) AS snippet,
                    page_range, source_path
             FROM search_index
             WHERE search_index MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![fts_query, limit], |row| {
            Ok(SearchHit {
                course: row.get(0)?,
                path: row.get(1)?,
                kind: row.get(2)?,
                title: row.get(3)?,
                snippet: row.get(4)?,
                page_range: row.get(5)?,
                source_path: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn empty_query_returns_no_hits() {
        let root = std::env::temp_dir().join(format!("arbor-search-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        db::open(&root).unwrap();
        let hits = search_documents(&root, "   ", 10).unwrap();
        assert!(hits.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
