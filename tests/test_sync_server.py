"""Tests for the sync server (stdlib only). Run from the project folder:

    python -m unittest discover -s tests

They use a throw-away data folder and a local port, never the real server or data.
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

_DATA_DIR = tempfile.mkdtemp(prefix="budget-test-")
os.environ["DATA_DIR"] = _DATA_DIR
os.environ["SYNC_TOKEN"] = "unused-by-tests"
os.environ["PORT"] = "0"

import sync_server as s  # noqa: E402

# Made-up values for the tests only (they are not a real passphrase).
DUMMY_PASSWORD = "dummy-value"
ODD_PASSWORD = "pässwörd ✓"
U_PASSWORD = "u:literal"


def rec(record_id, version=1, deleted=False, **extra):
    """Builds a sample record; extra keyword arguments add or override fields."""
    base = {"id": record_id, "name": "item", "version": version, "deleted": deleted,
            "updatedAt": "2026-10-07T10:00:00Z", "deviceId": "A", "dateAdded": "2026-10-01T00:00:00Z"}
    base.update(extra)
    return base


class MergeRules(unittest.TestCase):
    """merge_collection: versioning, no-op resends, tombstones, conflict forks, income, bad input."""
    def merge(self, server_items, client_items, name="bills"):
        """Runs one merge and returns (the updated server list, the conflicts)."""
        conflicts = s.merge_collection(server_items, client_items, name)
        return server_items, conflicts

    def test_new_record_is_added_at_version_1(self):
        items, c = self.merge([], [rec("a", version=0)])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["version"], 1)
        self.assertEqual(c, [])

    def test_clean_edit_bumps_the_version(self):
        items, c = self.merge([rec("a", 3, name="old")], [rec("a", 3, name="new")])
        self.assertEqual((items[0]["name"], items[0]["version"]), ("new", 4))
        self.assertEqual(c, [])

    def test_resending_identical_content_changes_nothing(self):
        items, c = self.merge([rec("a", 6)], [rec("a", 5)])
        self.assertEqual((len(items), items[0]["version"]), (1, 6))
        self.assertEqual(c, [])

    def test_bookkeeping_changes_alone_are_not_an_edit(self):
        items, _ = self.merge([rec("a", 2)], [rec("a", 2, updatedAt="2030-01-01T00:00:00Z", deviceId="B")])
        self.assertEqual(items[0]["version"], 2)

    def test_stale_live_copy_never_overwrites_a_delete(self):
        items, c = self.merge([rec("a", 6, deleted=True)], [rec("a", 5)])
        self.assertTrue(items[0]["deleted"])
        self.assertEqual((len(items), c), (1, []))

    def test_stale_edited_copy_of_a_deleted_record_is_dropped(self):
        items, c = self.merge([rec("a", 6, deleted=True)], [rec("a", 5, name="edited after delete")])
        self.assertTrue(items[0]["deleted"])
        self.assertEqual((len(items), c), (1, []))

    def test_a_delete_from_a_stale_device_wins_over_a_newer_edit(self):
        items, c = self.merge([rec("a", 6, name="edited elsewhere")], [rec("a", 5, deleted=True, updatedAt="2026-10-08T00:00:00Z")])
        self.assertEqual((len(items), items[0]["deleted"], items[0]["version"], items[0]["name"]), (1, True, 7, "edited elsewhere"))
        self.assertEqual(c, [])

    def test_a_real_edit_conflict_is_kept_as_a_second_record(self):
        items, c = self.merge([rec("a", 6, name="A")], [rec("a", 5, name="B")])
        self.assertEqual(len(items), 2)
        self.assertEqual(len(c), 1)
        self.assertEqual(c[0]["originalId"], "a")

    def test_restoring_a_deleted_record_at_the_current_version_works(self):
        items, _ = self.merge([rec("a", 6, deleted=True)], [rec("a", 6, deleted=False)])
        self.assertEqual((items[0]["deleted"], items[0]["version"]), (False, 7))

    def test_clean_delete(self):
        items, _ = self.merge([rec("a", 5)], [rec("a", 5, deleted=True)])
        self.assertEqual((items[0]["deleted"], items[0]["version"]), (True, 6))

    def test_income_ignores_dateAdded_differences(self):
        items, c = self.merge([rec("2026-09-22", 4, dateAdded="x", amount=100)], [rec("2026-09-22", 4, dateAdded="y", amount=100)], "income")
        self.assertEqual((len(items), items[0]["version"], c), (1, 4, []))

    def test_projected_income_records_merge_by_id_like_any_income_record(self):
        """Projected income is an income-list record with its own id and a projectedFor field: no server change needed."""
        server = [rec("projected-2026-10-15", version=3, projectedFor="2026-10-15", projected=500)]
        items, c = self.merge(server, [rec("projected-2026-10-15", version=3, projectedFor="2026-10-15", projected=650, updatedAt="2026-10-08T10:00:00Z")], "income")
        self.assertEqual(c, [])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["projected"], 650)
        self.assertEqual(items[0]["projectedFor"], "2026-10-15")

    def test_income_conflict_never_makes_a_second_entry_for_the_date(self):
        server = [rec("2026-09-22", 6, amount=100, updatedAt="2026-10-01T10:00:00Z")]
        items, c = self.merge(server, [rec("2026-09-22", 5, amount=250, updatedAt="2026-10-02T10:00:00Z")], "income")
        self.assertEqual((len(items), c), (1, []))
        self.assertEqual((items[0]["amount"], items[0]["version"]), (250, 7), "the more recent edit wins")

    def test_income_conflict_keeps_the_newer_server_value(self):
        server = [rec("2026-09-22", 6, amount=100, updatedAt="2026-10-05T10:00:00Z")]
        items, c = self.merge(server, [rec("2026-09-22", 5, amount=250, updatedAt="2026-10-02T10:00:00Z")], "income")
        self.assertEqual((len(items), c, items[0]["amount"], items[0]["version"]), (1, [], 100, 6))

    def test_a_newer_income_entry_beats_an_older_cleared_one(self):
        """A date cleared on one device and filled in later on another keeps the newer value."""
        server = [rec("2026-10-01", version=3, deleted=True, updatedAt="2026-10-02T10:00:00Z", deviceId="A", amount=0)]
        client = [rec("2026-10-01", version=1, deleted=False, updatedAt="2026-10-05T10:00:00Z", deviceId="B", amount=50)]
        merged, conflicts = self.merge(server, client, "income")
        self.assertEqual(len(merged), 1)
        self.assertFalse(merged[0]["deleted"])
        self.assertEqual(merged[0]["amount"], 50)
        self.assertEqual(merged[0]["version"], 4)
        self.assertEqual(conflicts, [])

    def test_an_older_income_entry_does_not_beat_a_newer_clear(self):
        server = [rec("2026-10-01", version=3, deleted=True, updatedAt="2026-10-09T10:00:00Z", deviceId="A", amount=0)]
        client = [rec("2026-10-01", version=1, deleted=False, updatedAt="2026-10-05T10:00:00Z", deviceId="B", amount=50)]
        merged, _ = self.merge(server, client, "income")
        self.assertTrue(merged[0]["deleted"])

    def test_a_device_editing_its_own_record_again_is_an_update_not_a_fork(self):
        """After a lost reply the device is behind on version; its next edit must not duplicate the record."""
        server = [rec("n1", version=2, deviceId="A", updatedAt="2026-10-07T10:00:00Z", name="first edit")]
        client = [rec("n1", version=1, deviceId="A", updatedAt="2026-10-07T11:00:00Z", name="second edit")]
        merged, conflicts = self.merge(server, client)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["name"], "second edit")
        self.assertEqual(merged[0]["version"], 3)
        self.assertEqual(conflicts, [])

    def test_an_older_copy_of_its_own_edit_arriving_late_is_dropped_not_forked(self):
        """A delayed duplicate of a device's earlier edit must not become a second record."""
        server = [rec("n1", version=3, deviceId="A", updatedAt="2026-10-07T11:00:00Z", name="second edit")]
        client = [rec("n1", version=1, deviceId="A", updatedAt="2026-10-07T10:00:00Z", name="first edit")]
        merged, conflicts = self.merge(server, client)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["name"], "second edit")
        self.assertEqual(conflicts, [])

    def test_a_stale_income_clear_never_wipes_a_newer_amount(self):
        """Income: a 'cleared' made earlier on an out-of-date device must not delete a newer amount for the date."""
        server = [rec("2026-10-01", version=2, deleted=False, updatedAt="2026-10-05T10:00:00Z", deviceId="B", amount=50)]
        client = [rec("2026-10-01", version=1, deleted=True, updatedAt="2026-10-03T10:00:00Z", deviceId="A", amount=0)]
        merged, _ = self.merge(server, client, "income")
        self.assertFalse(merged[0]["deleted"])
        self.assertEqual(merged[0]["amount"], 50)

    def test_a_different_device_with_a_stale_version_still_forks(self):
        server = [rec("n1", version=2, deviceId="A", updatedAt="2026-10-07T10:00:00Z", name="from A")]
        client = [rec("n1", version=1, deviceId="B", updatedAt="2026-10-07T11:00:00Z", name="from B")]
        merged, conflicts = self.merge(server, client)
        self.assertEqual(len(merged), 2)
        self.assertEqual(len(conflicts), 1)

    def test_other_lists_still_keep_both_sides_of_a_conflict(self):
        items, c = self.merge([rec("a", 6, name="A")], [rec("a", 5, name="B")], "bills")
        self.assertEqual((len(items), len(c)), (2, 1))

    def test_malformed_records_do_not_abort_the_sync(self):
        items, _ = self.merge([], [None, 5, "x", {"no": "id"}, {"id": ["list"]}, {"id": ""}, rec("ok", 0), rec("bad-version", version="abc")])
        self.assertEqual(sorted(i["id"] for i in items), ["bad-version", "ok"])

    def test_tombstone_against_tombstone_never_forks(self):
        items, c = self.merge([rec("a", 6, deleted=True, name="x")], [rec("a", 5, deleted=True, name="y")])
        self.assertEqual((len(items), c), (1, []))


class Storage(unittest.TestCase):
    """Loading and saving the data file: defaults, retired lists, daily backups, corruption, read errors."""
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="sm-store-"))
        s.DATA_DIR = self.dir
        s.DATA_PATH = self.dir / "sync_data.json"
        s.BACKUP_DIR = self.dir / "backups"

    def test_missing_file_gives_an_empty_dataset(self):
        data = s.load_dataset()
        self.assertEqual(sorted(data), sorted(s.COLLECTION_NAMES))
        self.assertTrue(all(v == [] for v in data.values()))

    def test_saving_recreates_a_data_folder_that_has_vanished(self):
        """Temporary storage can be cleared under a running service: the next save must still work."""
        gone = self.dir / "wiped"
        s.DATA_DIR, s.DATA_PATH, s.BACKUP_DIR = gone, gone / "sync_data.json", gone / "backups"
        s.save_dataset(s.empty_dataset())
        self.assertTrue(s.DATA_PATH.exists())

    def test_the_default_data_folder_is_a_writable_temp_folder_not_a_disk_path(self):
        """Without DATA_DIR the server must not default to a path that only exists on a paid disk."""
        env = {k: v for k, v in os.environ.items() if k != "DATA_DIR"}
        out = subprocess.run([sys.executable, "-c", "import sync_server; print(sync_server.DATA_DIR)"],
                             cwd=ROOT / "server", env=env, capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(pathlib.Path(out), pathlib.Path(tempfile.gettempdir()) / "budget-data")
        self.assertNotIn("/var/data", (ROOT / "server" / "sync_server.py").read_text(encoding="utf-8"))

    def test_a_data_file_with_invalid_text_bytes_is_set_aside_not_fatal(self):
        """Bytes that are not valid UTF-8 must not make every request fail: set the file aside and carry on."""
        s.DATA_PATH.write_bytes(b"\xff\xfe\x00 not text")
        data = s.load_dataset()
        self.assertTrue(all(v == [] for v in data.values()))
        self.assertTrue(list(self.dir.glob("sync_data.corrupt-*.json")))

    def test_stray_non_record_items_in_a_stored_list_are_dropped(self):
        s.DATA_PATH.write_text(json.dumps({"bills": [5, None, "x", {"id": "n1"}]}))
        data = s.load_dataset()
        self.assertEqual(data["bills"], [{"id": "n1"}])

    def test_a_data_file_that_is_not_an_object_is_set_aside_not_trusted(self):
        """Valid JSON of the wrong shape must be quarantined like a corrupt file, not copied over the good .bak."""
        s.DATA_PATH.write_text("[1, 2, 3]")
        data = s.load_dataset()
        self.assertTrue(all(v == [] for v in data.values()))
        self.assertFalse(s.DATA_PATH.exists())
        self.assertTrue(list(self.dir.glob("sync_data.corrupt-*.json")))

    def test_lists_the_app_no_longer_has_are_dropped(self):
        s.DATA_PATH.write_text(json.dumps({"recurringIncome": [{"id": "b"}], "courses": [{"id": "c"}], "deadlines": [{"id": "d"}]}))
        data = s.load_dataset()
        self.assertNotIn("courses", data)
        self.assertNotIn("deadlines", data)
        self.assertEqual(len(data["recurringIncome"]), 1)
        s.save_dataset(data)
        saved = json.loads(s.DATA_PATH.read_text())
        self.assertNotIn("courses", saved)

    def test_first_save_makes_no_backup_but_later_saves_do(self):
        d = s.empty_dataset()
        d["bills"].append(rec("n1", t="v1"))
        s.save_dataset(d)
        self.assertFalse(s.BACKUP_DIR.exists() and any(s.BACKUP_DIR.iterdir()))
        d["bills"][0]["t"] = "v2"
        s.save_dataset(d)
        today = time.strftime("%Y-%m-%d", time.gmtime())
        snap = s.BACKUP_DIR / f"sync_data-{today}.json"
        self.assertTrue(snap.exists())
        self.assertEqual(json.loads(snap.read_text())["bills"][0]["t"], "v1")
        d["bills"][0]["t"] = "v3"
        s.save_dataset(d)
        self.assertEqual(json.loads(snap.read_text())["bills"][0]["t"], "v1", "today's restore point must not be overwritten")
        self.assertTrue((self.dir / "sync_data.bak").exists())

    def test_only_the_newest_30_restore_points_are_kept(self):
        d = s.empty_dataset()
        s.save_dataset(d)
        s.BACKUP_DIR.mkdir(exist_ok=True)
        import datetime
        for i in range(40):
            (s.BACKUP_DIR / f"sync_data-{(datetime.date(2026, 1, 1) + datetime.timedelta(i)).isoformat()}.json").write_text("{}")
        (s.BACKUP_DIR / "notes.txt").write_text("keep me")
        s.save_dataset(d)
        names = [f.name for f in s.BACKUP_DIR.iterdir() if s.BACKUP_NAME_RE.match(f.name)]
        self.assertEqual(len(names), s.BACKUP_KEEP)
        self.assertTrue((s.BACKUP_DIR / "notes.txt").exists())

    def test_a_corrupt_file_is_set_aside_and_the_backup_is_used(self):
        d = s.empty_dataset()
        d["bills"].append(rec("n1"))
        s.save_dataset(d)
        d["bills"].append(rec("n2"))
        s.save_dataset(d)
        s.DATA_PATH.write_text("{corrupt")
        data = s.load_dataset()
        self.assertEqual(len(data["bills"]), 1)
        self.assertTrue(any(p.name.startswith("sync_data.corrupt-") for p in self.dir.iterdir()))

    def test_a_read_error_is_not_treated_as_no_data(self):
        s.DATA_PATH.write_text(json.dumps(s.empty_dataset()))
        original = pathlib.Path.open

        def broken(self, *a, **k):
            if self.name == "sync_data.json":
                raise PermissionError("cannot read")
            return original(self, *a, **k)

        pathlib.Path.open = broken
        try:
            with self.assertRaises(PermissionError):
                s.load_dataset()
        finally:
            pathlib.Path.open = original


class Http(unittest.TestCase):
    """The real server on a local port: auth, bad requests, round trips, CORS, and /api/backup."""
    @classmethod
    def setUpClass(cls):
        cls.dir = pathlib.Path(tempfile.mkdtemp(prefix="sm-http-"))
        s.DATA_DIR = cls.dir
        s.DATA_PATH = cls.dir / "sync_data.json"
        s.BACKUP_DIR = cls.dir / "backups"
        cls.server = s.ThreadingHTTPServer(("127.0.0.1", 0), s.SyncHandler)
        cls.server.sync_token = DUMMY_PASSWORD
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def call(self, body, token=DUMMY_PASSWORD, path="/api/sync", raw=None, origin=None):
        """POSTs to the test server and returns (status, parsed JSON or None, response headers)."""
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
        headers = {"Content-Type": "application/json", "X-Sync-Token": token}
        if origin:
            headers["Origin"] = origin
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.load(r), dict(r.headers)
        except urllib.error.HTTPError as e:
            try:
                payload = json.load(e)
            except Exception:
                payload = None
            return e.code, payload, dict(e.headers)

    def test_wrong_or_missing_passphrase_is_refused(self):
        self.assertEqual(self.call({"clientVersion": 2, "collections": {}}, token="nope")[0], 401)
        self.assertEqual(self.call({"clientVersion": 2, "collections": {}}, token="")[0], 401)

    def test_a_wrong_passphrase_with_a_large_upload_still_gets_a_clean_401(self):
        """The server must finish reading the upload before refusing it, or the browser sees a reset instead of the 401."""
        big = {"clientVersion": 2, "collections": {"bills": [rec(f"big{i}", 0, name="x" * 80) for i in range(3000)]}}
        for _ in range(5):
            self.assertEqual(self.call(big, token="nope")[0], 401)

    def test_old_app_copies_are_turned_away(self):
        status, body, _ = self.call({"collections": {}})
        self.assertEqual(status, 426)
        self.assertIn("out of date", body["error"])
        self.assertEqual(self.call({"clientVersion": 1, "collections": {}})[0], 426)

    def test_bad_requests_get_a_clear_error(self):
        self.assertEqual(self.call(None, raw=b"[1, 2]")[0], 400)
        self.assertEqual(self.call(None, raw=b"{nope")[0], 400)
        self.assertEqual(self.call(None, raw=b"\xff\xfe")[0], 400)
        self.assertEqual(self.call({"clientVersion": 2, "collections": "not a dict"})[0], 400)
        self.assertEqual(self.call({}, path="/nope")[0], 404)

    def test_a_round_trip_stores_and_returns_records(self):
        status, body, _ = self.call({"clientVersion": 2, "collections": {"bills": [rec("rt1", 0, name="hello")]}})
        self.assertEqual(status, 200)
        self.assertEqual([r["id"] for r in body["collections"]["bills"]], ["rt1"])
        self.assertEqual(body["conflicts"], [])
        self.assertEqual(sorted(body["collections"]), sorted(s.COLLECTION_NAMES))

    def test_unknown_lists_are_ignored(self):
        status, body, _ = self.call({"clientVersion": 2, "collections": {"courses": [rec("x")], "bills": []}})
        self.assertEqual(status, 200)
        self.assertNotIn("courses", body["collections"])

    def test_non_ascii_passphrases_work_when_percent_encoded(self):
        self.server.sync_token = ODD_PASSWORD
        try:
            ok = self.call({"clientVersion": 2, "collections": {}}, token="u:" + urllib.parse.quote(ODD_PASSWORD))[0]
            bad = self.call({"clientVersion": 2, "collections": {}}, token="u:" + urllib.parse.quote("nope"))[0]
            self.assertEqual((ok, bad), (200, 401))
        finally:
            self.server.sync_token = DUMMY_PASSWORD

    def test_a_passphrase_that_itself_starts_with_u_colon_works(self):
        self.server.sync_token = U_PASSWORD
        try:
            self.assertEqual(self.call({"clientVersion": 2, "collections": {}}, token=U_PASSWORD)[0], 200)
        finally:
            self.server.sync_token = DUMMY_PASSWORD

    def test_only_the_apps_own_sites_get_cors_headers(self):
        _, _, ok = self.call({"clientVersion": 2, "collections": {}}, origin="https://michellefeliciano.github.io")
        _, _, other = self.call({"clientVersion": 2, "collections": {}}, origin="https://evil.example")
        self.assertEqual(ok.get("Access-Control-Allow-Origin"), "https://michellefeliciano.github.io")
        self.assertIsNone(other.get("Access-Control-Allow-Origin"))

    def test_backup_endpoint_lists_and_returns_restore_points(self):
        self.call({"clientVersion": 2, "collections": {"bills": [rec("bk1", 0)]}})
        self.call({"clientVersion": 2, "collections": {"bills": [rec("bk2", 0)]}})
        status, body, _ = self.call({}, path="/api/backup")
        self.assertEqual(status, 200)
        today = time.strftime("%Y-%m-%d", time.gmtime())
        self.assertTrue(any(b["date"] == today for b in body["backups"]))
        status, body, _ = self.call({"date": today}, path="/api/backup")
        self.assertEqual(status, 200)
        self.assertEqual(sorted(body["collections"]), sorted(s.COLLECTION_NAMES))

    def test_backup_endpoint_is_protected_and_safe(self):
        self.assertEqual(self.call({}, token="nope", path="/api/backup")[0], 401)
        self.assertEqual(self.call({"date": "2020-01-01"}, path="/api/backup")[0], 404)
        self.assertEqual(self.call({"date": "../sync_data"}, path="/api/backup")[0], 400)
        self.assertEqual(self.call({"date": "2026-01-01/../../x"}, path="/api/backup")[0], 400)
        self.assertEqual(self.call({"date": "٢٠٢٦-٠١-٠١"}, path="/api/backup")[0], 400)  # non-ASCII digits

    def test_nan_and_infinity_are_refused_so_replies_stay_valid_json(self):
        """Python's json accepts NaN; stored, it would make every later reply unparseable in a browser."""
        for bad in (b'{"clientVersion": 2, "collections": {"bills": [{"id": "n1", "x": NaN}]}}',
                    b'{"clientVersion": 2, "collections": {"bills": [{"id": "n2", "x": Infinity}]}}'):
            self.assertEqual(self.call(None, raw=bad)[0], 400)
        _, body, _ = self.call({"clientVersion": 2, "collections": {}})
        self.assertNotIn("n1", json.dumps(body))
        self.assertNotIn("n2", json.dumps(body))


if __name__ == "__main__":
    unittest.main()
