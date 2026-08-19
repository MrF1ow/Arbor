from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from arbor_worker.alignment import PageRange
from arbor_worker.auth import check_codex_auth
from arbor_worker.events import EventEmitter
from arbor_worker.pipeline import run_update
from arbor_worker.planning import build_plan, plan_to_dict
from arbor_worker.provider.codex import CodexCliProvider
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.settings import default_settings, load_models, load_settings

_DEFAULT_FAKE_MD = (
    "# Lecture\n## Overview\nThis is a fake digest overview long enough to validate.\n"
    "## Key Concepts\n- concept\n## Important Details\n- detail\n"
    "## Questions to Review\n- question?\n"
)


def cmd_check_auth(args) -> int:
    settings = default_settings()
    res = check_codex_auth()
    print(json.dumps({
        "authenticated": res.ok,
        "reason": res.reason,
        "docs_url": settings.docs_url,
    }))
    return 0 if res.ok else 1


def cmd_list_models(args) -> int:
    root = Path(getattr(args, "root", None) or ".")
    models = load_models(root)
    print(json.dumps({"models": [{"id": m.id, "label": m.label} for m in models]}))
    return 0


def _load_selections(plan_path: str | None) -> dict[str, list[PageRange] | None]:
    if not plan_path:
        return {}
    data = json.loads(Path(plan_path).read_text())
    selections: dict[str, list[PageRange] | None] = {}
    for item in data.get("selections", []):
        if "ranges" not in item or item["ranges"] is None:
            selections[item["path"]] = None
            continue
        selections[item["path"]] = [_parse_range(pair) for pair in item["ranges"]]
    return selections


def _parse_range(raw) -> PageRange:
    if not isinstance(raw, (list, tuple)) or len(raw) != 2:
        raise ValueError(f"range must be [start, end], got {raw!r}")
    return PageRange(int(raw[0]), int(raw[1]))


def cmd_plan_update(args) -> int:
    root = Path(args.root)
    settings = load_settings(root)
    print(json.dumps(plan_to_dict(build_plan(root, settings))))
    return 0


def cmd_update(args) -> int:
    root = Path(args.root)
    settings = load_settings(root)
    emitter = EventEmitter(sys.stdout)

    if args.provider == "codex":
        auth = check_codex_auth()
        if not auth.ok:
            emitter.auth_failed(reason=auth.reason, docs_url=settings.docs_url)
            return 3
        provider = CodexCliProvider(models=load_models(root))
    else:
        provider = FakeProvider(markdown=os.environ.get("ARBOR_FAKE_MD", _DEFAULT_FAKE_MD))

    cancel_file = Path(args.cancel_file) if args.cancel_file else None
    try:
        result = run_update(
            root,
            args.model,
            provider,
            emitter,
            settings,
            selections=_load_selections(getattr(args, "plan", None)),
            cancel_file=cancel_file,
        )
    except Exception as e:  # surface unexpected failures as an error event
        emitter.error(message=str(e))
        emitter.run_done(processed=0, failed=0, skipped=0)
        return 1
    return 0 if result.failed == 0 else 1
