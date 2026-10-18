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
    return 2
