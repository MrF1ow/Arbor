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

Packages in v0.4.3 are pure Python and use the standard library only. Arbor does not run `setup.py` or `pip install` for them.

Before a package is trusted, Arbor inspects the directory tree: paths must stay inside the package root, directory symlinks are forbidden, and file symlinks must not point outside the package. Inspection reads files and parses JSON; it does not import, execute, or install package code. Execution happens only at run time, after the user confirms the declared permissions for that package id and commit.

The worker passes a **context object** that enforces what the skill is allowed to do according to its permissions. Host paths are not exposed as attributes on that object (only the context methods are visible to the skill). This is not an OS sandbox. A package that already knows a path can still call `open()` on it, or use the network on its own, outside what Arbor can stop in this release.

## Install

Skill packages install from a **git URL at a pinned full commit SHA**. The pin must be exactly 40 lowercase hexadecimal characters. Branch names (`main`, `HEAD`, `master`), tags, and short SHAs are refused before git runs.

Optional **`subdir`** selects a directory inside the repository (for example `packages/anki-export`). The installed tree is that directory’s contents at the top level (`arbor-skill.json` at the root of the install path), not the whole repository.

Installed packages live under:

`$DATA_HOME/arbor/skills/<id>/<commit>/`

`<id>` is the manifest id. `<commit>` is the pin. `DATA_HOME` is the worker’s `--data-home` argument when set, otherwise `XDG_DATA_HOME`, otherwise `~/.local/share`.

After a successful install, **`arbor-install.json`** in that directory records installer metadata (id, commit, git URL, subdir). It is not part of the package manifest; inspection allows extra files.

Install clones offline, verifies the checked-out commit matches the pin, runs the same tree inspection as above (path confinement, no escaping symlinks), and **refuses any absolute symlink** under the package (absolute links would point outside the install directory after copy). It copies files without following symlinks, recreates safe relative symlinks inside the destination, and does **not** import package code, run `pip`, or execute `setup.py`. v0.4.3 packages are pure Python and stdlib-only.

Reinstalling the same id and pin replaces that directory atomically. Different pins for one id coexist as sibling directories under `skills/<id>/`.

**Uninstall** deletes `skills/<id>/` entirely (every pinned commit for that id). Permission confirmations stored in app settings are a later step and are **not** removed by uninstall in this release.

The worker passes a **context object** at run time that enforces declared permissions. Host paths are not exposed as attributes on that object. This is not an OS sandbox.

## Marketplace

The marketplace index is a JSON file listing **skill** and **provider** packages. Each row includes a **git** URL, a pinned full **commit** SHA (40 lowercase hex characters; branch names are rejected in the index), optional **subdir**, and declared **permissions**. Provider rows are metadata only in this release; Arbor does not install or run them from the index.

The default index path in the Arbor repository is **`marketplace/index.json`**. There is no separate marketplace repository in v0.4.3. When loading an index from git, the **ref** argument may be a branch, tag, or commit; package pins inside the JSON remain full SHAs. Fetching an index reads and parses JSON only — Arbor does not import or execute files from a cloned index repository.

The worker command **`arbor-worker skill-index --source PATH [--ref REF]`** prints the parsed index as JSON. When the desktop setting for the index source is empty, it will use **`find_default_index`** starting from the app checkout to locate **`marketplace/index.json`**.

The in-repo index lists **`anki-export`** with **`commit`** pinned to the git commit that added **`marketplace/packages/anki-export`** (not the commit that added the index row). The canonical **`git`** URL is **`https://github.com/MrF1ow/Arbor.git`**. For offline install, use a local bare clone of that repository and point a copy of the index at the clone by setting **`git`** to the clone’s **`file://`** URL while keeping the same **`commit`** pin and **`subdir`**.

## Run

An installed skill runs in a **worker child process** only after the caller sets **`confirmed`** and passes a **`grants`** list that matches the manifest **`permissions`** for that package **id** and **commit** exactly (order does not matter). If `confirmed` is false, or the grant set differs, the worker raises before spawning the child and does not import package code.

Each pinned **commit** installs to its own directory under `skills/<id>/<commit>/`. A new commit is a new install path and needs its own confirmation. This release does **not** persist confirmations in app settings; the caller (CLI or desktop) passes them on each run. **Uninstall** still removes only the install tree under `skills/<id>/` and does not clear stored confirmations (a later unit).

The child process receives a fresh environment: **`HOME`**, **`TMPDIR`**, and **`XDG_*`** point at a scratch directory, not the user’s real home. **`PYTHONNOUSERSITE=1`** and **`PYTHONDONTWRITEBYTECODE=1`** are set. Provider API keys and base URLs (`ARBOR_OPENAI_API_KEY`, `ARBOR_ANTHROPIC_API_KEY`, `ARBOR_LMSTUDIO_API_KEY`, `ARBOR_OPENAI_BASE_URL`, `ARBOR_ANTHROPIC_BASE_URL`, `ARBOR_OLLAMA_BASE_URL`, `ARBOR_LMSTUDIO_BASE_URL`) are passed through **only** when the manifest includes **`provider`**. Other parent secrets (for example `OPENAI_API_KEY` or ad hoc variables) are not copied. The **`network`** permission is a user acknowledgment only; it does not change the environment and Arbor does not block sockets in the child.

At run time the worker loads the entry module with **`importlib`** (fixed module name `arbor_installed_skill`) and calls the manifest function with a **context object**. Methods enforce declared permissions:

- **`read_course_file(relative)`** — reads bytes under the current course directory (requires **`read_course`**). Relative paths must stay inside that directory; `.`, `..`, absolute paths, backslashes, and symlinks on the path are refused.
- **`write_export(relative, data)`** — writes bytes under the export directory (requires **`write_export_dir`**). Creates parent directories only inside that directory; writes use **`O_NOFOLLOW`** so symlinks are not followed.
- **`write_study_file(relative, data)`** — writes bytes under `<course>/study` (requires **`write_course_study`**), creating **`study`** when missing if the path is not reached through a symlink.

Missing permissions raise even when the relative path would otherwise be safe. This is the worker API, **not an OS sandbox**: a skill that already knows a path can still call **`open()`** on it, or use the network on its own, outside what Arbor can stop in this release.
