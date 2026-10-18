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

## Install

Skill packages install from a **git URL at a pinned full commit SHA**. The pin must be exactly 40 lowercase hexadecimal characters. Branch names (`main`, `HEAD`, `master`), tags, and short SHAs are refused before git runs.

Optional **`subdir`** selects a directory inside the repository (for example `packages/anki-export`). The installed tree is that directory’s contents at the top level (`arbor-skill.json` at the root of the install path), not the whole repository.

Installed packages live under:

`$DATA_HOME/arbor/skills/<id>/<commit>/`

`<id>` is the manifest id. `<commit>` is the pin. `DATA_HOME` is the worker’s `--data-home` argument when set, otherwise `XDG_DATA_HOME`, otherwise `~/.local/share`.

After a successful install, **`arbor-install.json`** in that directory records installer metadata (id, commit, git URL, subdir). It is not part of the package manifest; inspection allows extra files.

Install clones offline, verifies the checked-out commit matches the pin, runs the same tree inspection as above (path confinement, no escaping symlinks), and **refuses any absolute symlink** under the package (absolute links would point outside the install directory after copy). It copies files without following symlinks, recreates safe relative symlinks inside the destination, and does **not** import package code, run `pip`, or execute `setup.py`. v4.3.0 packages are pure Python and stdlib-only.

Reinstalling the same id and pin replaces that directory atomically. Different pins for one id coexist as sibling directories under `skills/<id>/`.

**Uninstall** deletes `skills/<id>/` entirely (every pinned commit for that id). Permission confirmations stored in app settings are a later step and are **not** removed by uninstall in this release.

The worker passes a **context object** at run time that enforces declared permissions. This is not an OS sandbox.

The marketplace index and Settings UI for skills are specified in the v4.3.0 plan and are not part of install itself.
