from __future__ import annotations

import argparse

from arbor_worker import __version__
from arbor_worker.provider.registry import provider_choices
from arbor_worker.study_progress import _MISSING


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="arbor-worker")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command")

    ca = sub.add_parser("check-auth", help="Check provider CLI authentication.")
    ca.add_argument(
        "--provider",
        default="codex",
        choices=provider_choices(),
        help="Provider to check (default: codex).",
    )
    lm = sub.add_parser("list-models", help="List selectable models as JSON.")
    lm.add_argument("--root", default=None, help="Knowledge root to read .arbor/models.json from.")
    lm.add_argument(
        "--provider",
        default="codex",
        choices=provider_choices(),
        help="Provider whose models to list (default: codex).",
    )
    lp = sub.add_parser("list-providers", help="List CLI providers and model catalogs as JSON.")
    lp.add_argument("--root", default=None, help="Knowledge root to read .arbor/models.json from.")

    pu = sub.add_parser("plan-update", help="List sources that would be processed, as JSON.")
    pu.add_argument("--root", required=True, help="Path to the Knowledge git repo.")

    up = sub.add_parser("update", help="Process new/changed sources under a Knowledge root.")
    up.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    up.add_argument("--model", required=True, help="Model id passed to the provider.")
    up.add_argument("--provider", default="codex", choices=provider_choices())
    up.add_argument("--cancel-file", default=None, help="If this file appears, stop at the next range or action boundary.")
    up.add_argument("--plan", default=None, help='JSON file with {"selections": [{"path", "ranges"}]}.')

    gen = sub.add_parser("generate", help="Generate study artifacts for a course.")
    gen.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    gen.add_argument("--course", required=True, help="Course directory name.")
    gen.add_argument("--skill", required=True, help="Study skill to generate.")
    gen.add_argument("--force", action="store_true", help="Regenerate a current artifact.")
    gen.add_argument("--provider", default="codex", choices=provider_choices())
    gen.add_argument("--model", default=None, help="Model id passed to the provider.")

    ri = sub.add_parser("reindex", help="Rebuild the search index under a Knowledge root.")
    ri.add_argument("--root", required=True, help="Path to the Knowledge git repo.")

    embed = sub.add_parser("embed", help="Build the semantic search index.")
    embed.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    embed.add_argument("--force", action="store_true", help="Rebuild unchanged digests.")
    embed.add_argument("--provider", default="hashed", choices=["hashed", "fake"])

    search = sub.add_parser("embed-search", help="Search the semantic index.")
    search.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    search.add_argument("--query", required=True, help="Semantic search query.")
    search.add_argument("--limit", type=int, default=25)
    search.add_argument("--provider", default="hashed", choices=["hashed", "fake"])

    sub.add_parser("chat", help="Grounded course Q&A (JSON on stdin, NDJSON on stdout).")

    sp = sub.add_parser("study-progress", help="Course review progress (JSON on stdout).")
    sp.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    sp.add_argument("--course", required=True, help="Course directory name.")
    sp_sub = sp.add_subparsers(dest="study_action")

    sp_sub.add_parser("show", help="Print progress.json (migrate legacy if needed).")
    sp_sub.add_parser("weak", help="Print weak topic aggregates.")

    sp_due = sp_sub.add_parser("due", help="Print due flashcard ids for the deck.")
    sp_due.add_argument("--now", default=None, help="UTC instant (ISO-8601).")

    sp_grade = sp_sub.add_parser("grade", help="Record a flashcard review result.")
    sp_grade.add_argument("--id", required=True, dest="card_id", help="Flashcard id.")
    sp_grade.add_argument(
        "--result",
        required=True,
        choices=["again", "wrong", "mastered"],
    )
    sp_grade.add_argument("--now", default=None, help="UTC instant (ISO-8601).")
    sp_grade.add_argument("--digest", default=None, help="Source digest path.")
    sp_grade.add_argument(
        "--heading",
        default=_MISSING,
        nargs="?",
        const="",
        help="Source heading.",
    )

    sp_quiz = sp_sub.add_parser("quiz", help="Record a quiz answer result.")
    sp_quiz.add_argument("--id", required=True, dest="question_id", help="Question id.")
    sp_quiz.add_argument("--result", required=True, choices=["correct", "wrong"])
    sp_quiz.add_argument("--now", default=None, help="UTC instant (ISO-8601).")
    sp_quiz.add_argument("--digest", default=None, help="Source digest path.")
    sp_quiz.add_argument(
        "--heading",
        default=_MISSING,
        nargs="?",
        const="",
        help="Source heading.",
    )

    sp_sub.add_parser("recommend", help="Print deterministic study recommendations.")

    plan = sub.add_parser("study-plan", help="Generate study/plan.md for a course.")
    plan.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    plan.add_argument("--course", required=True, help="Course directory name.")
    plan.add_argument("--provider", default="codex", choices=provider_choices())
    plan.add_argument("--model", default=None, help="Model id passed to the provider.")
    plan.add_argument("--exam-date", default=None, dest="exam_date", help="Exam date (YYYY-MM-DD).")

    ac = sub.add_parser("append-card", help="Append one flashcard to the course deck.")
    ac.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    ac.add_argument("--course", required=True, help="Course directory name.")
    ac.add_argument("--front", required=True, help="Card front text.")
    ac.add_argument("--back", required=True, help="Card back text.")
    ac.add_argument("--digest", required=True, help="Source digest path (digests/name.md).")
    ac.add_argument("--heading", default=None, help="Source heading.")
    ac.add_argument("--page", default=None, help="Source page or page range.")

    sync = sub.add_parser("sync", help="Sync a Knowledge root with its arbor remote.")
    sync.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    sync.add_argument(
        "--set-remote",
        default=None,
        dest="set_remote",
        metavar="URL",
        help="Configure the arbor remote and exit.",
    )
    shared = sync.add_mutually_exclusive_group()
    shared.add_argument(
        "--shared",
        action="store_true",
        dest="shared",
        default=None,
        help="Mark the root as shared (merge instead of rebase).",
    )
    shared.add_argument(
        "--no-shared",
        action="store_false",
        dest="shared",
        help="Mark the root as not shared (rebase on sync).",
    )
    sync.add_argument(
        "--show",
        action="store_true",
        help="Print configured remote and shared mode without syncing.",
    )

    sr = sub.add_parser("sync-resolve", help="Record a sync conflict resolution.")
    sr.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    sr.add_argument("--path", required=True, help="Conflicted file path relative to root.")
    sr.add_argument(
        "--side",
        required=True,
        choices=["mine", "theirs", "edit"],
        help="Resolution side.",
    )
    sr.add_argument("--content", default=None, help="Full file text when side is edit.")

    sc = sub.add_parser("sync-continue", help="Continue sync after resolving conflicts.")
    sc.add_argument("--root", required=True, help="Path to the Knowledge git repo.")

    lc = sub.add_parser("library-create", help="Create a shared library at a Knowledge root.")
    lc.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    lc.add_argument("--name", default=None, help="Library display name (default: folder name).")

    lj = sub.add_parser("library-join", help="Clone and join a shared library.")
    lj.add_argument("--url", required=True, help="Git URL of the shared library.")
    lj.add_argument("--dest", required=True, help="Empty folder path for the clone.")

    si = sub.add_parser("skill-install", help="Install a skill package from a pinned git commit.")
    si.add_argument("--git", required=True, dest="git", help="Git URL or local repository path.")
    si.add_argument("--commit", required=True, help="Full 40-character lowercase commit SHA.")
    si.add_argument("--subdir", default=None, help="Package directory inside the repository.")
    si.add_argument("--data-home", default=None, dest="data_home", help="Arbor data home (XDG data dir).")
    si.add_argument("--id", default=None, dest="id", help="Expected manifest id.")

    su = sub.add_parser("skill-uninstall", help="Remove an installed skill package id.")
    su.add_argument("--id", required=True, dest="id", help="Skill package id.")
    su.add_argument("--data-home", default=None, dest="data_home", help="Arbor data home (XDG data dir).")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        code = exc.code
        return code if isinstance(code, int) else (0 if code is None else 1)
    if args.command is None:
        parser.print_help()
        return 2
    if args.command == "check-auth":
        from arbor_worker.commands import cmd_check_auth
        return cmd_check_auth(args)
    if args.command == "list-models":
        from arbor_worker.commands import cmd_list_models
        return cmd_list_models(args)
    if args.command == "list-providers":
        from arbor_worker.commands import cmd_list_providers
        return cmd_list_providers(args)
    if args.command == "plan-update":
        from arbor_worker.commands import cmd_plan_update
        return cmd_plan_update(args)
    if args.command == "update":
        from arbor_worker.commands import cmd_update
        return cmd_update(args)
    if args.command == "generate":
        from arbor_worker.commands import cmd_generate
        return cmd_generate(args)
    if args.command == "reindex":
        from arbor_worker.commands import cmd_reindex
        return cmd_reindex(args)
    if args.command == "embed":
        from arbor_worker.commands import cmd_embed
        return cmd_embed(args)
    if args.command == "embed-search":
        from arbor_worker.commands import cmd_embed_search
        return cmd_embed_search(args)
    if args.command == "chat":
        from arbor_worker.commands import cmd_chat
        return cmd_chat(args)
    if args.command == "study-progress":
        from arbor_worker.commands import cmd_study_progress
        return cmd_study_progress(args)
    if args.command == "study-plan":
        from arbor_worker.commands import cmd_study_plan
        return cmd_study_plan(args)
    if args.command == "append-card":
        from arbor_worker.commands import cmd_append_card
        return cmd_append_card(args)
    if args.command == "sync":
        from arbor_worker.commands import cmd_sync
        return cmd_sync(args)
    if args.command == "sync-resolve":
        from arbor_worker.commands import cmd_sync_resolve
        return cmd_sync_resolve(args)
    if args.command == "sync-continue":
        from arbor_worker.commands import cmd_sync_continue
        return cmd_sync_continue(args)
    if args.command == "library-create":
        from arbor_worker.commands import cmd_library_create
        return cmd_library_create(args)
    if args.command == "library-join":
        from arbor_worker.commands import cmd_library_join
        return cmd_library_join(args)
    if args.command == "skill-install":
        from arbor_worker.skillpkg.install import cmd_skill_install
        return cmd_skill_install(args)
    if args.command == "skill-uninstall":
        from arbor_worker.skillpkg.install import cmd_skill_uninstall
        return cmd_skill_uninstall(args)
    return 2
