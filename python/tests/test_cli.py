import io
import contextlib

from arbor_worker import cli


def run(argv):
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def test_version_flag():
    code, out, _ = run(["--version"])
    assert code == 0
    assert "0.1.0" in out


def test_subcommands_registered():
    parser = cli.build_parser()
    # argparse stores subparser choices on the _SubParsersAction
    actions = [a for a in parser._actions if getattr(a, "choices", None)]
    choices = set()
    for a in actions:
        choices.update(a.choices.keys())
    assert {"check-auth", "list-models", "update"}.issubset(choices)
