import hashlib
from pathlib import Path

from arbor_worker.hashing import hash_file


def test_hash_matches_hashlib(tmp_path: Path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"hello arbor")
    assert hash_file(p) == hashlib.sha256(b"hello arbor").hexdigest()


def test_hash_changes_with_content(tmp_path: Path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"one")
    h1 = hash_file(p)
    p.write_bytes(b"two")
    assert hash_file(p) != h1


def test_hash_bytes_matches_hashlib():
    from arbor_worker.hashing import hash_bytes

    assert hash_bytes(b"hello arbor") == hashlib.sha256(b"hello arbor").hexdigest()
