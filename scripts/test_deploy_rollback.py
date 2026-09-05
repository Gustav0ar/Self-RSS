"""Exercise deployment recovery functions without contacting a container daemon."""

import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest


DEPLOY_SCRIPT = Path(__file__).with_name("deploy-vps.sh")
PREVIOUS_API = "sha256:" + "a" * 64
PREVIOUS_WEB = "sha256:" + "b" * 64
TARGET_API = "sha256:" + "c" * 64
TARGET_WEB = "sha256:" + "d" * 64
HEAD = "1" * 40

FAKE_CONTAINER = r'''#!/usr/bin/env python3
import json, os, re, subprocess, sys
from pathlib import Path
state_file = Path(os.environ["FAKE_CONTAINER_STATE"])
state = json.loads(state_file.read_text())
args = sys.argv[1:]
state["commands"].append(args)
def persist():
    state_file.write_text(json.dumps(state))
persist()
if args[0] == "inspect":
    if ".Image" in args[2]:
        print(state["containers"].get(args[-1], ""))
    else:
        print("healthy")
elif args[:2] == ["image", "inspect"]:
    image = state["tags"].get(args[-1], args[-1])
    if image not in state["known_images"]:
        sys.exit(1)
    print(image)
elif args[0] == "tag":
    if state.get("tag_error"):
        sys.exit(1)
    state["tags"][args[2]] = state["tags"].get(args[1], args[1])
    persist()
elif args[0] == "run":
    state["fingerprint_writer_states"].append(state["writers_stopped"])
    persist()
    if state.get("fingerprint_error"):
        sys.exit(1)
    code = args[args.index("-e") + 1]
    code = code.replace("/app/data", str(Path.cwd() / "data"))
    sys.exit(subprocess.run([os.environ["BUN_BINARY"], "-e", code]).returncode)
elif args[0] == "compose":
    if "stop" in args:
        state["writers_stopped"] = True
        persist()
    elif "up" in args:
        if "--no-deps" not in args:
            state["redis_recreated"] = True
        files = [Path(args[i + 1]) for i, arg in enumerate(args) if arg == "-f"]
        overrides = {}
        for file in files[1:]:
            overrides.update(re.findall(r"  (api|worker|web):\n    image: (\S+)", file.read_text()))
        if overrides:
            state["containers"] = {"selffeed-" + key: value for key, value in overrides.items()}
        else:
            state["containers"] = {
                "selffeed-api": state["tags"][os.environ["API_REFERENCE"]],
                "selffeed-worker": state["tags"][os.environ["API_REFERENCE"]],
                "selffeed-web": state["tags"][os.environ["WEB_REFERENCE"]],
            }
        state["writers_stopped"] = False
        persist()
    elif "ps" not in args and "logs" not in args:
        sys.exit("Unexpected compose action")
else:
    sys.exit("Unexpected container action")
'''


class DeployRollbackTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="self-feed-rollback-")
        self.addCleanup(self.temporary.cleanup)
        self.site = Path(self.temporary.name)
        (self.site / "data").mkdir()
        self.database = self.site / "data/self-feed.db"
        with sqlite3.connect(self.database) as db:
            db.executescript("""
                CREATE TABLE articles (id TEXT PRIMARY KEY, body TEXT);
                CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at INTEGER);
                INSERT INTO articles VALUES ('before', 'retained');
                INSERT INTO __drizzle_migrations VALUES (1, 'original-migration', 1);
            """)
        self.old_compose = "services:\n  api:\n    image: previous-api\n"
        self.old_env = "IMAGE_TAG=previous\nDOMAIN_NAME=example.invalid\nJWT_SECRET=test-only-value\n"
        (self.site / "docker-compose.yml").write_text(self.old_compose)
        (self.site / ".env").write_text(self.old_env)
        self.fake = self.site / "fake-container"
        self.fake.write_text(FAKE_CONTAINER)
        self.fake.chmod(0o700)
        self.state_file = self.site / "container-state.json"
        self.api_reference = f"ghcr.io/test/self-feed-api:sha-{HEAD[:7]}"
        self.web_reference = f"ghcr.io/test/self-feed-web:sha-{HEAD[:7]}"
        self.write_state({
            "containers": {"selffeed-api": PREVIOUS_API, "selffeed-worker": PREVIOUS_API, "selffeed-web": PREVIOUS_WEB},
            "tags": {self.api_reference: TARGET_API, self.web_reference: TARGET_WEB},
            "known_images": [PREVIOUS_API, PREVIOUS_WEB, TARGET_API, TARGET_WEB],
            "commands": [], "writers_stopped": False, "fingerprint_writer_states": [], "redis_recreated": False,
        })
        self.environment = os.environ | {
            "DEPLOY_PATH": str(self.site), "HEAD_SHA": HEAD, "IMAGE_OWNER": "test",
            "GITHUB_REPOSITORY": "test/self-feed", "COMPOSE_CMD": f"{self.fake} compose",
            "FAKE_CONTAINER_STATE": str(self.state_file), "API_REFERENCE": self.api_reference,
            "WEB_REFERENCE": self.web_reference,
            "BUN_BINARY": os.environ.get("BUN_BINARY", shutil.which("bun") or "bun"),
            "CONTAINER_HEALTH_ATTEMPTS": "1",
        }
        # Load the script's real functions, excluding its top-level deployment.
        self.functions = DEPLOY_SCRIPT.read_text().split("# Ensure the data dir exists", 1)[0]

    def read_state(self):
        return json.loads(self.state_file.read_text())

    def write_state(self, state):
        self.state_file.write_text(json.dumps(state))

    def shell(self, command):
        return subprocess.run(
            ["bash", "-c", self.functions + "\n" + command], env=self.environment,
            text=True, capture_output=True, timeout=20,
        )

    def capture(self):
        result = self.shell("save_current_images")
        self.assertEqual(0, result.returncode, result.stderr)

    def roll_out(self, change=None):
        (self.site / "docker-compose.yml").write_text("services:\n  api:\n    image: target-api\n")
        (self.site / ".env").write_text("IMAGE_TAG=target\nDOMAIN_NAME=example.invalid\nJWT_SECRET=target-test-value\n")
        state = self.read_state()
        state["containers"] = {"selffeed-api": TARGET_API, "selffeed-worker": TARGET_API, "selffeed-web": TARGET_WEB}
        self.write_state(state)
        with sqlite3.connect(self.database) as db:
            if change == "schema":
                db.execute("ALTER TABLE articles ADD COLUMN new_field TEXT")
            if change in {"schema", "ledger"}:
                db.execute("INSERT INTO __drizzle_migrations VALUES (2, 'new-migration', 2)")
            db.execute("INSERT INTO articles (id, body) VALUES ('after', 'post-deploy user write')")

    def assert_user_write_preserved(self):
        with sqlite3.connect(self.database) as db:
            self.assertEqual("post-deploy user write", db.execute("SELECT body FROM articles WHERE id='after'").fetchone()[0])

    def test_unchanged_schema_restores_matching_config_and_images_without_reverting_data(self):
        self.capture()
        self.roll_out()
        result = self.shell("save_current_images\nexport IMAGE_TAG=target\nrollback_deploy")
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertEqual(self.old_compose, (self.site / "docker-compose.yml").read_text())
        self.assertEqual(self.old_env, (self.site / ".env").read_text())
        self.assertEqual(PREVIOUS_API, self.read_state()["containers"]["selffeed-api"])
        self.assertFalse(self.read_state()["redis_recreated"])
        self.assertEqual([False, True], self.read_state()["fingerprint_writer_states"])
        self.assert_user_write_preserved()

    def test_changed_schema_or_ledger_refuses_image_downgrade(self):
        self.capture()
        self.roll_out("schema")
        result = self.shell("save_current_images\nrollback_deploy")
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertIn("image: target-api", (self.site / "docker-compose.yml").read_text())
        self.assertIn("IMAGE_TAG=target", (self.site / ".env").read_text())
        self.assertEqual(TARGET_API, self.read_state()["containers"]["selffeed-api"])
        self.assertTrue(self.read_state()["writers_stopped"])
        self.assertEqual([False, True], self.read_state()["fingerprint_writer_states"])
        self.assert_user_write_preserved()

    def test_data_only_migration_ledger_change_also_refuses_downgrade(self):
        self.capture()
        self.roll_out("ledger")
        result = self.shell("save_current_images\nrollback_deploy")
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertEqual(TARGET_API, self.read_state()["containers"]["selffeed-api"])
        self.assert_user_write_preserved()

    def test_committed_migration_in_wal_also_refuses_downgrade(self):
        connection = sqlite3.connect(self.database)
        self.addCleanup(connection.close)
        connection.execute("PRAGMA journal_mode=WAL")
        self.capture()
        self.roll_out("schema")
        self.assertGreater(Path(str(self.database) + "-wal").stat().st_size, 0)
        result = self.shell("save_current_images\nrollback_deploy")
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assert_user_write_preserved()

    def test_failed_capture_cannot_publish_a_partial_recovery_set(self):
        state = self.read_state()
        state["tag_error"] = True
        self.write_state(state)
        result = self.shell("save_current_images || exit 1")
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertFalse((self.site / ".deploy-recovery" / HEAD).exists())
        self.assertEqual(self.old_compose, (self.site / "docker-compose.yml").read_text())

    def test_unreadable_schema_fails_closed_after_stopping_writers(self):
        self.capture()
        self.roll_out()
        state = self.read_state()
        state["fingerprint_error"] = True
        self.write_state(state)
        result = self.shell("save_current_images\nrollback_deploy")
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertTrue(self.read_state()["writers_stopped"])
        self.assertIn("image: target-api", (self.site / "docker-compose.yml").read_text())
        self.assert_user_write_preserved()

    def test_retry_preserves_the_original_recovery_set(self):
        self.capture()
        recovery = self.site / ".deploy-recovery" / HEAD
        original = {file.name: file.read_bytes() for file in recovery.iterdir() if file.is_file()}
        self.roll_out("schema")
        self.capture()
        self.assertEqual(original, {file.name: file.read_bytes() for file in recovery.iterdir() if file.is_file()})
        self.assertEqual(0o600, (recovery / ".env").stat().st_mode & 0o777)

    def test_redeploy_of_a_successful_sha_captures_the_current_baseline(self):
        self.capture()
        self.roll_out("schema")
        result = self.shell("mark_deploy_success")
        self.assertEqual(0, result.returncode, result.stderr)
        self.capture()
        result = self.shell("save_current_images\nrollback_deploy")
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertEqual(TARGET_API, self.read_state()["containers"]["selffeed-api"])
        self.assertIn("IMAGE_TAG=target", (self.site / ".env").read_text())
        self.assert_user_write_preserved()


if __name__ == "__main__":
    unittest.main()
