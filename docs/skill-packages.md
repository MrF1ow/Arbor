# Arbor skill packages

A skill package is a directory that contains a manifest file named `arbor-skill.json` and the Python modules the skill needs. The manifest is a JSON object with these fields:

- **id** — Stable identifier: lowercase letters, digits, and hyphens only; must start with a letter or digit; at most 64 characters.
- **version** — Opaque version string (letters, digits, and `._+-`); not a filesystem path.
- **kind** — Must be `"skill"`.
- **entry** — Entry point as `module:function`, where `module` uses dotted Python import syntax and `function` is a valid Python identifier. Arbor maps the module to a `.py` file relative to the package root (for example `anki_export:export_deck` → `anki_export.py`).
- **inputs** — List of unique input names (lowercase, digits, underscores).
- **outputs** — List of unique output names (same rules as inputs). Either list may be empty.
- **permissions** — List of unique permission names from the closed set below, in the order declared. The list may be empty.

Unknown manifest keys or permission names are rejected.

## Permissions

| Permission | Meaning |
|------------|---------|
| `read_course` | May read the current course only through the worker context (deck and digests). No raw course path is handed to the skill. |
| `write_course_study` | May write the current course's study files only through that context. |
| `write_export_dir` | May create files only inside the user-chosen export directory, through that context. Names that escape the directory are refused. |
| `provider` | The worker may pass provider API-key environment variables. Without this permission, those variables are removed before the skill runs. |
| `network` | The user acknowledges the skill may open network sockets. Arbor does not install a firewall for skill code. |

## Package layout and inspection

Packages in v4.3.0 are pure Python and use the standard library only. Arbor does not run `setup.py` or `pip install` for them.

Before a package is trusted, Arbor inspects the directory tree: paths must stay inside the package root, directory symlinks are forbidden, and file symlinks must not point outside the package. Inspection reads files and parses JSON; it does not import, execute, or install package code. Execution happens only at run time, after the user confirms the declared permissions for that package id and commit.

The worker passes a **context object** that enforces what the skill is allowed to do according to its permissions. This is not an OS sandbox. A package that ignores the context and calls `open()` or the network on its own is outside what Arbor can stop in this release.

Install flow, the marketplace index, and the Settings UI for skills are specified in the v4.3.0 plan and are not part of the manifest validation described here.
