from __future__ import annotations

import argparse

from arbor_worker import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="arbor-worker")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("check-auth", help="Check Codex CLI authentication.")
    lm = sub.add_parser("list-models", help="List selectable models as JSON.")
    lm.add_argument("--root", default=None, help="Knowledge root to read .arbor/models.json from.")

    pu = sub.add_parser("plan-update", help="List sources that would be processed, as JSON.")
    pu.add_argument("--root", required=True, help="Path to the Knowledge git repo.")

    up = sub.add_parser("update", help="Process new/changed sources under a Knowledge root.")
    up.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    up.add_argument("--model", required=True, help="Model id passed to the provider.")
    up.add_argument("--provider", default="codex", choices=["codex", "fake"])
    up.add_argument("--cancel-file", default=None, help="If this file appears, stop at the next range or action boundary.")
    up.add_argument("--plan", default=None, help='JSON file with {"selections": [{"path", "ranges"}]}.')

    gen = sub.add_parser("generate", help="Generate study artifacts for a course.")
    gen.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    gen.add_argument("--course", required=True, help="Course directory name.")
    gen.add_argument("--skill", required=True, help="Study skill to generate.")
    gen.add_argument("--force", action="store_true", help="Regenerate a current artifact.")
    gen.add_argument("--provider", default="codex", choices=["codex", "fake"])
    gen.add_argument("--model", default=None, help="Model id passed to the provider.")

    ri = sub.add_parser("reindex", help="Rebuild the search index under a Knowledge root.")
    ri.add_argument("--root", required=True, help="Path to the Knowledge git repo.")

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
    return 2
