use rusqlite::params;
use std::path::Path;

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
pub struct SearchHit {
    pub course: String,
    pub path: String,
    pub kind: String,
    pub title: String,
    pub snippet: String,
    pub page_range: Option<String>,
    pub source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
}

/// Study rows are stored as `<course>/study/<file>.json#<id>`; a `#` in a class name
/// must not turn a digest row into an item.
fn item_id_from_path(kind: &str, path: &str) -> Option<String> {
    if !matches!(kind, "card" | "question" | "concept") {
        return None;
    }
    let (head, id) = path.rsplit_once('#')?;
    let (_, file) = head.rsplit_once("/study/")?;
    if !file.ends_with(".json") || id.is_empty() {
        return None;
    }
    Some(id.to_string())
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
    let terms = trimmed
        .split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ");
    // The column filter binds to one phrase, so group the terms.
    let fts_query = format!("{{title body}} : ({terms})");
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
            let path: String = row.get(1)?;
            let kind: String = row.get(2)?;
            Ok(SearchHit {
                course: row.get(0)?,
                path: path.clone(),
                item_id: item_id_from_path(&kind, &path),
                kind,
                title: row.get(3)?,
                snippet: row.get(4)?,
                page_range: row.get(5)?,
                source_path: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[cfg(feature = "desktop-runtime")]
pub fn search_semantic_documents(
    app_dir: &Path,
    knowledge_root: &Path,
    query: &str,
    limit: u32,
    extra_env: &[(&str, &str)],
) -> Result<Vec<SearchHit>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let root = knowledge_root.to_string_lossy().into_owned();
    let limit = limit.to_string();
    let value = crate::worker::run_worker_json(
        app_dir,
        &[
            "embed-search",
            "--root",
            &root,
            "--query",
            query,
            "--limit",
            &limit,
            "--provider",
            "hashed",
        ],
        extra_env,
    )?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn insert_row(conn: &rusqlite::Connection, row: (&str, &str, &str, &str, &str)) {
        conn.execute(
            "INSERT INTO search_index (course, path, kind, title, body, page_range, source_path)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL)",
            row,
        )
        .unwrap();
    }

    #[test]
    fn search_finds_card_by_front_only_term_with_item_id() {
        let root =
            std::env::temp_dir().join(format!("arbor-search-card-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let conn = db::open(&root).unwrap();
        insert_row(
            &conn,
            (
                "Bio",
                "Bio/study/flashcards.json#fc_test",
                "card",
                "Zorbamax",
                "Zorbamax rare back",
            ),
        );
        let hits = search_documents(&root, "Zorbamax", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "card");
        assert_eq!(hits[0].item_id.as_deref(), Some("fc_test"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn search_ignores_metadata_columns_for_query() {
        let root =
            std::env::temp_dir().join(format!("arbor-search-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let conn = db::open(&root).unwrap();
        insert_row(
            &conn,
            (
                "Bio",
                "Bio/study/flashcards.json#fc_x",
                "card",
                "Harmless title",
                "Harmless body text",
            ),
        );
        let hits = search_documents(&root, "Bio", 10).unwrap();
        assert!(hits.is_empty());
        let hits = search_documents(&root, "card", 10).unwrap();
        assert!(hits.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn multi_word_query_ignores_metadata_in_either_order() {
        let root =
            std::env::temp_dir().join(format!("arbor-search-multi-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let conn = db::open(&root).unwrap();
        insert_row(
            &conn,
            (
                "Helix",
                "Helix/study/concepts.json#c_one",
                "concept",
                "Light reactions",
                "Plain summary",
            ),
        );
        for query in [
            "light concept",
            "concept light",
            "light Helix",
            "Helix light",
            "light study",
            "study light",
        ] {
            let hits = search_documents(&root, query, 10).unwrap();
            assert!(hits.is_empty(), "{query} matched metadata");
        }
        assert_eq!(search_documents(&root, "light reactions", 10).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn item_id_only_for_study_rows_not_hash_in_class_name() {
        let root =
            std::env::temp_dir().join(format!("arbor-search-hash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let conn = db::open(&root).unwrap();
        insert_row(
            &conn,
            (
                "C# Basics",
                "C# Basics/digests/intro.md",
                "digest",
                "Intro",
                "Pointers galore",
            ),
        );
        insert_row(
            &conn,
            (
                "C# Basics",
                "C# Basics/study/flashcards.json#fc_ptr",
                "card",
                "Pointers",
                "Pointers back",
            ),
        );
        let hits = search_documents(&root, "pointers", 10).unwrap();
        assert_eq!(hits.len(), 2);
        let digest = hits.iter().find(|h| h.kind == "digest").unwrap();
        assert_eq!(digest.item_id, None);
        let card = hits.iter().find(|h| h.kind == "card").unwrap();
        assert_eq!(card.item_id.as_deref(), Some("fc_ptr"));
        let _ = std::fs::remove_dir_all(&root);
    }

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

    #[test]
    fn empty_semantic_query_returns_no_hits() {
        let hits = search_semantic_documents(
            Path::new("/missing/app"),
            Path::new("/missing/knowledge"),
            "   ",
            10,
            &[],
        )
        .unwrap();

        assert!(hits.is_empty());
    }
}
