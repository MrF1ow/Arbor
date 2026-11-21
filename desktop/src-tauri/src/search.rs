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
    let phrase = query
        .replace('"', "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if phrase.is_empty() {
        return Ok(Vec::new());
    }
    let conn = crate::db::open(knowledge_root)?;
    // One FTS5 phrase over title and body: the words must be adjacent and in order.
    // `"` is stripped, so nothing typed can end the phrase or add syntax.
    let fts_query = format!("{{title body}} : \"{phrase}\"");
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
                snippet: plain_snippet(&row.get::<_, String>(4)?),
                page_range: row.get(5)?,
                source_path: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// An FTS snippet of Markdown source as plain text: no heading, list or emphasis
/// markers, no `<!-- … -->` comments (page markers), table borders and separator rows
/// dropped, links and images reduced to their text, whitespace collapsed.
pub fn plain_snippet(snippet: &str) -> String {
    let snippet = strip_comments(snippet);
    let mut out = String::with_capacity(snippet.len());
    for line in snippet.lines() {
        let line = strip_table_syntax(line);
        let line = strip_line_marker(line.trim_start());
        out.push_str(&strip_inline(line));
        out.push(' ');
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Drops `<!-- … -->` spans, a cut-off `<!--` tail, and a cut-off `… -->` head (the FTS
/// snippet window can start or end inside a comment).
fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("<!--") {
        // A `-->` before the first `<!--` closes a comment the window started inside.
        if let Some(close) = cut_comment_head(&rest[..open]) {
            rest = &rest[close + 3..];
            continue;
        }
        out.push_str(&rest[..open]);
        match rest[open + 4..].find("-->") {
            Some(close) => rest = &rest[open + 4 + close + 3..],
            None => return out,
        }
    }
    match cut_comment_head(rest) {
        Some(close) => out.push_str(&rest[close + 3..]),
        None => out.push_str(rest),
    }
    out
}

/// Where a comment the snippet window started inside ends: a `-->` whose text before it
/// looks like the tail of a marker comment (`…pages:1-6 `), not prose with an arrow in it.
fn cut_comment_head(text: &str) -> Option<usize> {
    let close = text.find("-->")?;
    let head = text[..close].trim_start_matches('…').trim();
    let marker_like = head.len() <= 40
        && head.chars().all(|c| c.is_ascii_alphanumeric() || "/:-_".contains(c))
        && (head.contains("pages") || head.contains(':') || head.chars().all(|c| c.is_ascii_digit() || c == '-'));
    marker_like.then_some(close)
}

/// On a line with `|` cell borders: borders become spaces and `---`/`:---:` separator cells go.
fn strip_table_syntax(line: &str) -> String {
    if !line.contains('|') {
        return line.to_string();
    }
    line.replace('|', " ")
        .split_whitespace()
        .filter(|cell| {
            let dashes = cell.trim_matches(':');
            !(dashes.len() >= 3 && dashes.chars().all(|c| c == '-'))
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Removes a leading `#` heading marker (and closing `#`s) or a `- `/`* `/`+ `/`1. ` list marker.
fn strip_line_marker(line: &str) -> &str {
    let hashes = line.chars().take_while(|c| *c == '#').count();
    if hashes > 0 && (line.len() == hashes || line[hashes..].starts_with(char::is_whitespace)) {
        let rest = line[hashes..].trim();
        let closed = rest.trim_end_matches('#');
        return if closed.len() != rest.len() && (closed.is_empty() || closed.ends_with(char::is_whitespace)) {
            closed.trim_end()
        } else {
            rest
        };
    }
    for marker in ["- ", "* ", "+ "] {
        if let Some(rest) = line.strip_prefix(marker) {
            return rest;
        }
    }
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 {
        if let Some(rest) = line[digits..].strip_prefix(". ") {
            return rest;
        }
    }
    line
}

/// `![alt](url)` and `[text](url)` become the alt or text; `*` and `` ` `` are dropped, and
/// `_` too when it opens or closes a word (so `snake_case` keeps its underscores).
fn strip_inline(line: &str) -> String {
    let mut text = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(open) = rest.find('[') {
        let before = rest[..open].strip_suffix('!').unwrap_or(&rest[..open]);
        let after = &rest[open + 1..];
        let link = after.find("](").and_then(|close| {
            let label = &after[..close];
            let tail = &after[close + 2..];
            (!label.contains('[')).then_some(())?;
            let end = tail.find(')')?;
            Some((label, &tail[end + 1..]))
        });
        match link {
            Some((label, tail)) => {
                text.push_str(before);
                text.push_str(label);
                rest = tail;
            }
            None => {
                text.push_str(&rest[..=open]);
                rest = after;
            }
        }
    }
    text.push_str(rest);

    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    for (i, c) in chars.iter().enumerate() {
        match c {
            '*' | '`' => {}
            '_' => {
                let word_before = i > 0 && chars[i - 1].is_alphanumeric();
                let word_after = chars.get(i + 1).is_some_and(|n| n.is_alphanumeric());
                if word_before && word_after {
                    out.push('_');
                }
            }
            _ => out.push(*c),
        }
    }
    out
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
    fn search_on_a_deleted_library_root_errors_and_leaves_it_absent() {
        let root = std::env::temp_dir().join(format!("arbor-search-gone-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let err = search_documents(&root, "mitosis", 10).unwrap_err();
        assert!(err.starts_with("Library folder not found:"), "unexpected error: {err}");
        assert!(!root.exists(), "search must not recreate the library root");
    }

    fn phrase_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("arbor-search-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn multi_word_query_matches_only_the_exact_phrase() {
        let root = phrase_root("phrase");
        let conn = db::open(&root).unwrap();
        insert_row(
            &conn,
            ("Neph", "Neph/digests/a.md", "digest", "Glomerulopathies", "Minimal change disease causes nephrotic syndrome in kids."),
        );
        insert_row(
            &conn,
            ("Psych", "Psych/digests/b.md", "digest", "Stages of change", "A minimal sign of change shows the disease is not the issue."),
        );
        let hits = search_documents(&root, "minimal change disease", 10).unwrap();
        assert_eq!(hits.len(), 1, "words apart must not match");
        assert_eq!(hits[0].course, "Neph");
        let hits = search_documents(&root, "Minimal Change Disease", 10).unwrap();
        assert_eq!(hits.len(), 1, "case-insensitive");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn quotes_and_extra_spaces_do_not_change_the_phrase() {
        let root = phrase_root("quotes");
        let conn = db::open(&root).unwrap();
        insert_row(
            &conn,
            ("Neph", "Neph/digests/a.md", "digest", "Glomerulopathies", "Minimal change disease causes nephrotic syndrome."),
        );
        for query in [
            "  minimal   change disease ",
            "\"minimal change disease\"",
            "minimal \"change\" disease",
            "minimal\tchange\ndisease",
        ] {
            assert_eq!(search_documents(&root, query, 10).unwrap().len(), 1, "{query:?}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn query_of_only_quotes_returns_no_hits() {
        let root = phrase_root("onlyquotes");
        db::open(&root).unwrap();
        assert!(search_documents(&root, " \"\" \" ", 10).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn fts_syntax_characters_cannot_break_the_match() {
        let root = phrase_root("syntax");
        let conn = db::open(&root).unwrap();
        insert_row(
            &conn,
            ("Bio", "Bio/digests/a.md", "digest", "Syntax", "Plain body about a and b."),
        );
        for query in ["\"a*b\" -c:d", "a* ^b", "NEAR(a b)", "(a OR", "title:x", "---", "* -"] {
            assert!(search_documents(&root, query, 10).is_ok(), "{query:?} broke MATCH");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn hyphenated_phrase_matches_adjacent_tokens() {
        let root = phrase_root("hyphen");
        let conn = db::open(&root).unwrap();
        insert_row(
            &conn,
            ("Cardio", "Cardio/digests/a.md", "digest", "Heart failure", "An ACE-inhibitor lowers afterload."),
        );
        assert_eq!(search_documents(&root, "ACE-inhibitor", 10).unwrap().len(), 1);
        assert_eq!(search_documents(&root, "ace inhibitor", 10).unwrap().len(), 1);
        assert!(search_documents(&root, "inhibitor ace", 10).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn snippets_are_plain_text() {
        let root = phrase_root("snippet");
        let conn = db::open(&root).unwrap();
        insert_row(
            &conn,
            (
                "Neph",
                "Neph/digests/a.md",
                "digest",
                "Glomerulopathies",
                "## Overview\n\n- **Minimal change disease** is the top cause of [nephrotic syndrome](https://x.test/n) in kids.",
            ),
        );
        let hits = search_documents(&root, "minimal change disease", 10).unwrap();
        assert_eq!(hits.len(), 1);
        let snippet = &hits[0].snippet;
        for bad in ["#", "**", "](", "- "] {
            assert!(!snippet.contains(bad), "{bad:?} left in {snippet:?}");
        }
        assert!(snippet.contains("Minimal change disease is the top cause of nephrotic syndrome in kids"), "{snippet:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn plain_snippet_strips_markdown() {
        assert_eq!(plain_snippet("# Heading"), "Heading");
        assert_eq!(plain_snippet("### Deep heading ###"), "Deep heading");
        assert_eq!(plain_snippet("a **bold** and *em* and _under_ and `code`"), "a bold and em and under and code");
        assert_eq!(plain_snippet("- one\n* two\n1. three\n12. four"), "one two three four");
        assert_eq!(plain_snippet("see [the docs](https://x.test/a_b) now"), "see the docs now");
        assert_eq!(plain_snippet("![a figure](img/x.png) caption"), "a figure caption");
        assert_eq!(plain_snippet("  many \n\n  spaces\t here  "), "many spaces here");
        assert_eq!(plain_snippet("snake_case_name stays"), "snake_case_name stays");
        assert_eq!(plain_snippet("2 * 3 = 6"), "2 3 = 6");
        assert_eq!(plain_snippet("…tail of [link](u"), "…tail of [link](u");
        assert_eq!(plain_snippet(""), "");
    }

    #[test]
    fn plain_snippet_keeps_prose_arrows() {
        assert_eq!(plain_snippet("ACE inhibitor --> lower BP"), "ACE inhibitor --> lower BP");
        assert_eq!(plain_snippet("…pages:1-6 --> Next topic"), "Next topic");
        assert_eq!(plain_snippet("a --> b <!-- arbor-pages:1-2 --> c"), "a --> b c");
    }

    #[test]
    fn plain_snippet_drops_tables_and_page_marker_comments() {
        // Real shapes from the digests and index rows.
        assert_eq!(
            plain_snippet("| Degree | Extent | Treatment | | --- | --- | --- |"),
            "Degree Extent Treatment"
        );
        assert_eq!(
            plain_snippet("first line of care … <!-- /arbor-pages:1-2 -->"),
            "first line of care …"
        );
        assert_eq!(plain_snippet("a <!-- arbor-pages:3 --> b <!-- /arbor-pages:3 --> c"), "a b c");
        // The snippet window can end mid-comment or start mid-comment.
        assert_eq!(plain_snippet("tail of text <!-- arbor-pa"), "tail of text");
        assert_eq!(plain_snippet("… -->\nnext page text"), "next page text");
        // Whole tables, aligned separators included.
        assert_eq!(
            plain_snippet("| a | b |\n| :--- | ---: |\n| c | d |\n|:---:|---|"),
            "a b c d"
        );
        assert_eq!(plain_snippet("x | y"), "x y");
        // Plain text without those shapes is untouched.
        assert_eq!(plain_snippet("a - b -- c"), "a - b -- c");
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
