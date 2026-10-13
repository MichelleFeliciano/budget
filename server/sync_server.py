#!/usr/bin/env python3
"""Budget sync server.

Serves a single API endpoint, POST /api/sync, over plain HTTP. Intended to
run on Render's free plan, which has no persistent disk: the data file lives in a
temporary folder and is lost whenever the service sleeps (after about 15 minutes
idle) or redeploys. That is acceptable because every device keeps its own full copy
and re-sends it on the next sync. Render terminates TLS at its
edge, so this process never handles certificates itself. The app's static
files (index.html/style.css/app.js) are hosted separately on GitHub Pages —
this server does not serve them. Stdlib only — no pip installs.
"""

# Endpoints (both POST, both need the X-Sync-Token header to match SYNC_TOKEN):
#   /api/sync    The app sends its collections; the server merges them into the
#                stored data and replies with the full merged result plus a list
#                of any conflicts it had to fork.
#   /api/backup  With no body, lists the daily restore points. With
#                {"date": "YYYY-MM-DD"}, returns that day's saved data.
#
# Merge rules (see merge_collection):
#   - The server owns each record's `version`; clients never choose it.
#   - Tombstones (deleted: true) win over stale live copies, so deletes stick.
#   - If two live copies conflict, the client's copy is saved as a new record
#     (a fork) so nothing is silently lost.
#   - Income is the exception: one entry per date, and the newest edit wins.
#   - Resending identical content is a no-op and does not bump the version.
#
# Backups: the first save each UTC day keeps a copy of the data as it was before
# that save, under DATA_DIR/backups, and the newest 30 are kept. On the free plan these
# disappear together with the data file, so they only help while the service stays awake.
#
# Environment variables:
#   PORT        Port to listen on (default 8443).
#   SYNC_TOKEN  Shared passphrase clients must send; the server refuses to start without it.
#   DATA_DIR    Folder holding sync_data.json and backups/. Defaults to a folder named
#               budget-data inside the system's temporary folder, which is always writable.
#               Point it at a persistent disk's mount path if the service ever gets one.

import hmac
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

PORT = int(os.environ.get("PORT", "8443"))
DATA_DIR = Path(os.environ.get("DATA_DIR") or Path(tempfile.gettempdir()) / "budget-data")
DATA_PATH = DATA_DIR / "sync_data.json"

# Automatic daily restore points. The first save on each UTC day first copies
# the data file as it stood BEFORE that day's changes to
# backups/sync_data-YYYY-MM-DD.json, then older ones beyond the newest 30 are
# deleted. Restoring "day D" means the state at the start of day D.
BACKUP_DIR = DATA_DIR / "backups"
BACKUP_KEEP = 30
BACKUP_NAME_RE = re.compile(r"^sync_data-(\d{4}-\d{2}-\d{2})\.json$")

# Every list the server stores: exactly the three lists the Budget app syncs. The app sends and
# expects these names, so do not rename or remove them. Any other list found in the data file is dropped.
COLLECTION_NAMES = ["bills", "income", "recurringIncome"]

# The app's HTML/JS is hosted separately from this server (GitHub Pages, not this machine), so
# browsers treat sync requests as cross-origin and block them without an explicit CORS allowlist.
# Only these exact origins are ever allowed to call the server from a browser. Set ALLOWED_ORIGINS
# (comma-separated, no trailing slash) to the address(es) Budget is hosted at.
ALLOWED_SYNC_ORIGINS = {
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "https://michellefeliciano.github.io").split(",")
    if origin.strip()
}

data_lock = threading.Lock()


def empty_dataset():
    """A fresh dataset: every known collection present and empty."""
    return {name: [] for name in COLLECTION_NAMES}


def load_dataset():
    """Reads the stored data file, repairing it if needed (corrupt file falls
    back to the .bak copy, missing collections are added, retired ones dropped).
    Callers must hold data_lock."""
    if not DATA_PATH.exists():
        return empty_dataset()
    # A transient OSError must NOT be treated as "no data": the next save would
    # overwrite the real file with an empty one. Let it propagate (the request
    # fails and the client just tries again later).
    try:
        with DATA_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            # Valid JSON but not our data (for example a list): treat it as corrupt, so it is set
            # aside instead of being copied over the good .bak by the next save.
            raise json.JSONDecodeError("data file is not an object", "", 0)
    except ValueError:  # includes JSONDecodeError and UnicodeDecodeError (bytes that are not valid text)
        # Corrupt file: set it aside instead of overwriting it, and fall back
        # to the last good backup if there is one.
        quarantine = DATA_PATH.with_name(f"sync_data.corrupt-{int(time.time())}.json")
        os.replace(DATA_PATH, quarantine)
        backup = DATA_PATH.with_suffix(".bak")
        if backup.exists():
            try:
                with backup.open("r", encoding="utf-8") as f:
                    data = json.load(f)
            except (ValueError, OSError):
                return empty_dataset()
        else:
            return empty_dataset()
    if not isinstance(data, dict):
        return empty_dataset()
    for name in COLLECTION_NAMES:
        if not isinstance(data.get(name), list):
            data[name] = []
        else:
            # Only real records are kept (a stray number or null in a list must not crash the merge).
            data[name] = [item for item in data[name] if isinstance(item, dict)]
    # Lists the app no longer has (coursework and appointments were removed) are dropped, so the
    # next save no longer carries them. Older daily restore points keep them
    # until they age out after BACKUP_KEEP days.
    for stale in [key for key in data if key not in COLLECTION_NAMES]:
        del data[stale]
    return data


def save_dataset(data):
    """Writes the data file safely: write to a temp file, keep a .bak of the
    previous version, take the daily snapshot, then swap the new file in.
    Callers must hold data_lock."""
    # The threading.Lock around every caller of this function is the real
    # correctness mechanism; os.replace() is defense in depth on top of it
    # (its atomicity isn't fully guaranteed on Windows, per CPython #143909).
    # The folder is recreated if it has vanished (temporary storage can be cleared under a running service).
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = DATA_PATH.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f)
        f.flush()
        os.fsync(f.fileno())
    if DATA_PATH.exists():
        shutil.copyfile(DATA_PATH, DATA_PATH.with_suffix(".bak"))
        try:
            snapshot_daily()
        except OSError as err:  # a backup problem must never block saving real data
            print(f"WARNING: daily backup failed: {err}", file=sys.stderr)
    os.replace(tmp_path, DATA_PATH)


def snapshot_daily():
    """Copies the current (pre-save) data file to today's restore point if
    today doesn't have one yet, then prunes to the newest BACKUP_KEEP."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    today = time.strftime("%Y-%m-%d", time.gmtime())
    target = BACKUP_DIR / f"sync_data-{today}.json"
    if not target.exists():
        shutil.copyfile(DATA_PATH, target)
    files = sorted(f for f in BACKUP_DIR.iterdir() if BACKUP_NAME_RE.match(f.name))
    for old in files[:-BACKUP_KEEP]:
        old.unlink()


def list_backups():
    """The available daily restore points, oldest first, as {"date", "bytes"}."""
    if not BACKUP_DIR.exists():
        return []
    out = []
    for f in sorted(BACKUP_DIR.iterdir()):
        m = BACKUP_NAME_RE.match(f.name)
        if m:
            out.append({"date": m.group(1), "bytes": f.stat().st_size})
    return out


# Fields that describe *who/when touched a record* rather than the record's
# actual real-world data. Excluded from the no-op/content-equality check
# below: conflict and no-op detection is content-based, `updatedAt` is
# display/audit only, and `deviceId` is the same kind of field. Comparing them
# would make identical records look different and inflate `version` on every sync.
# `dateAdded` and `deleted` are deliberately NOT in this set: they're
# meaningful data, not bookkeeping.
_BOOKKEEPING_FIELDS = {"version", "updatedAt", "deviceId"}

# Per-collection extra bookkeeping fields, beyond the universal set above.
# `income` uses id = dateKey (not a fresh UUID like every other collection)
# specifically so two devices independently entering the same date's income
# converge onto one record instead of duplicating — dateAdded differing
# between two independently-created same-dateKey records is the expected
# normal case here, not an anomaly, unlike every other collection where a
# dateAdded mismatch on a shared id is a real red flag worth surfacing.
_EXTRA_BOOKKEEPING_FIELDS_BY_COLLECTION = {"income": {"dateAdded"}}


def _content_matches(a, b, collection_name):
    """True if two records describe the same real-world data — i.e. this is
    a harmless resend/no-op (an already-applied edit retried, or a sync
    cycle where nothing changed), not a genuine conflicting change. Ignores
    `version` (the mechanism's own counter) and the audit-only bookkeeping
    fields `updatedAt`/`deviceId`; every domain field, plus `dateAdded` and
    `deleted`, are compared — except for `income`, where `dateAdded` is also
    excluded (see `_EXTRA_BOOKKEEPING_FIELDS_BY_COLLECTION` above)."""
    keys = set(a.keys()) | set(b.keys())
    keys -= _BOOKKEEPING_FIELDS | _EXTRA_BOOKKEEPING_FIELDS_BY_COLLECTION.get(collection_name, set())
    return all(a.get(k) == b.get(k) for k in keys)


def _reject_constant(name):
    """json.loads hook: Python accepts NaN/Infinity, but they are not valid JSON, so storing one
    would make every later reply unparseable in the browser for all devices."""
    raise ValueError(f"{name} is not valid JSON")


def _usable_id(value):
    """Record ids are strings (UUIDs / date keys). Anything unhashable or odd is skipped
    rather than crashing the whole sync request."""
    return isinstance(value, (str, int)) and not isinstance(value, bool) and value != ""


def _safe_version(value):
    """Versions are whole numbers; treat anything else (null, text, floats) as 0."""
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _replace_record(server_items, by_id, record_id, replacement):
    """Swaps the stored record with this id for `replacement`, keeping its position in the list."""
    by_id[record_id] = replacement
    for i, item in enumerate(server_items):
        if item.get("id") == record_id:
            server_items[i] = replacement
            return


def merge_collection(server_items, client_items, collection_name):
    """Applies one collection's client-submitted records onto the server's
    stored records, per the server-owned-version optimistic-concurrency
    algorithm. Mutates `server_items` and returns the list of genuine
    conflicts created (each `{"originalId": ..., "newId": ...}`). Never
    removes a record — tombstones (`deleted: true`) are merged like any
    other record so a delete round-trips to every other device instead of
    being lost."""
    by_id = {item["id"]: item for item in server_items if isinstance(item, dict) and _usable_id(item.get("id"))}
    conflicts = []

    for incoming in client_items:
        # One malformed record must not abort the whole sync (which would leave the
        # client retrying the same bad payload forever), so skip anything unusable.
        if not isinstance(incoming, dict):
            continue
        record_id = incoming.get("id")
        if not _usable_id(record_id):
            continue
        client_version = _safe_version(incoming.get("version", 0))
        existing = by_id.get(record_id)

        if existing is None:
            new_record = dict(incoming)
            new_record["version"] = 1
            server_items.append(new_record)
            by_id[record_id] = new_record
            continue

        server_version = _safe_version(existing.get("version", 0))

        if client_version < server_version:
            # A dropped response can make a client retry a payload the server
            # already applied — its version bookkeeping never advanced, so
            # this looks like a conflict even though nothing actually
            # diverged. If the content is identical to what's already stored
            # (ignoring version), treat it as a no-op replay instead of
            # manufacturing a duplicate.
            if _content_matches(existing, incoming, collection_name):
                continue

            # Deletes always win over a stale copy. A stale device that still
            # shows an item live (it hasn't pulled the delete yet) must never
            # bring it back as a fork, and a delete made on a stale device
            # must not be undone by someone's newer edit to a record the user
            # chose to remove. This is what made deleted items "come back".
            # The one exception is income, whose id IS its date: if the date was cleared earlier and a
            # device has since entered a newer value for it, that newer entry wins over the tombstone.
            if (collection_name == "income" and existing.get("deleted") and not incoming.get("deleted")
                    and str(incoming.get("updatedAt", "")) > str(existing.get("updatedAt", ""))):
                replacement = dict(incoming)
                replacement["version"] = server_version + 1
                _replace_record(server_items, by_id, record_id, replacement)
                continue
            if existing.get("deleted"):
                continue
            # Income: a stale device's "cleared" must not wipe a newer amount entered for that date elsewhere.
            if (collection_name == "income" and incoming.get("deleted") and not existing.get("deleted")
                    and str(incoming.get("updatedAt", "")) < str(existing.get("updatedAt", ""))):
                continue
            if incoming.get("deleted") and not existing.get("deleted"):
                tombstone = dict(existing)
                tombstone["deleted"] = True
                tombstone["updatedAt"] = incoming.get("updatedAt", existing.get("updatedAt"))
                tombstone["deviceId"] = incoming.get("deviceId", existing.get("deviceId"))
                tombstone["version"] = server_version + 1
                _replace_record(server_items, by_id, record_id, tombstone)
                continue

            # Income is one entry per date (its id IS the date), so a conflict must never
            # create a second entry for the same date: that would count the money twice.
            # The most recently edited version simply wins.
            if collection_name == "income":
                if str(incoming.get("updatedAt", "")) > str(existing.get("updatedAt", "")):
                    replacement = dict(incoming)
                    replacement["version"] = server_version + 1
                    _replace_record(server_items, by_id, record_id, replacement)
                continue

            # The same device editing its own record again (typically after a reply to its earlier
            # save was lost, so its version number is behind) is a plain update, not a conflict:
            # forking here would hand the user a duplicate of their own record.
            same_device = bool(incoming.get("deviceId")) and incoming.get("deviceId") == existing.get("deviceId")
            if same_device and str(incoming.get("updatedAt", "")) < str(existing.get("updatedAt", "")):
                continue  # a late or repeated older copy of its own edit: already superseded, not a conflict
            if same_device and str(incoming.get("updatedAt", "")) > str(existing.get("updatedAt", "")):
                replacement = dict(incoming)
                replacement["version"] = server_version + 1
                _replace_record(server_items, by_id, record_id, replacement)
                continue

            # Genuine conflict: someone else's write already landed on this
            # id since this client last synced. Keep the server's record
            # untouched and save the client's content as a brand-new record
            # instead — never silently discard either side.
            conflict_record = dict(incoming)
            conflict_record["id"] = str(uuid.uuid4())
            conflict_record["version"] = 1
            server_items.append(conflict_record)
            by_id[conflict_record["id"]] = conflict_record
            conflicts.append({"originalId": record_id, "newId": conflict_record["id"]})
            continue

        # client_version == server_version is the expected clean-update case.
        # client_version > server_version shouldn't happen under normal
        # operation (the server is the sole version authority) but is
        # accepted the same defensive way — e.g. if the datastore file was
        # ever reset — so a client is never left permanently stuck.
        #
        # Check content-equality before treating this as a real update. Every sync resends every
        # record, so this branch is reached for each unchanged record: without the check each sync
        # bumped every `version` (it once reached the hundreds), which made the conflict-fork path
        # above misfire. A content-identical resend
        # is a true no-op: leave `existing` untouched.
        if _content_matches(existing, incoming, collection_name):
            continue

        new_record = dict(incoming)
        new_record["version"] = max(server_version, client_version) + 1
        _replace_record(server_items, by_id, record_id, new_record)

    return conflicts


class SyncHandler(BaseHTTPRequestHandler):
    """Handles the HTTP requests: /api/sync, /api/backup, and CORS preflights."""
    server_version = "BudgetSync/1"
    # A connection that stalls (sends nothing) is dropped after 30 seconds instead of holding a thread forever.
    timeout = 30

    def _allowed_origin(self):
        """The request's Origin if it is on the allowlist, otherwise None."""
        origin = self.headers.get("Origin")
        return origin if origin in ALLOWED_SYNC_ORIGINS else None

    def _send_json(self, status, payload):
        """Sends a JSON response with the given status, including CORS headers."""
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # CORS headers belong on every response, not just success — the
        # client's JS specifically branches on response.status === 401 to
        # show "check passphrase", and a browser hides that status behind a
        # generic network error if the response lacks these headers.
        origin = self._allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def _discard_body(self):
        """Reads and throws away (up to 1 MB of) the request body. Replying before the client has finished
        sending can reset the connection, so the browser would see a network error instead of the reply."""
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            self.rfile.read(min(max(length, 0), 1024 * 1024))
        except (ValueError, OSError):
            pass

    def _check_token(self):
        """True if the X-Sync-Token header matches SYNC_TOKEN (constant-time compare)."""
        expected = self.server.sync_token
        got = self.headers.get("X-Sync-Token", "")
        # Compare bytes: str comparison raises TypeError on non-ASCII input.
        # A passphrase with non-ASCII characters arrives percent-encoded behind
        # a "u:" marker (headers can't carry raw non-ASCII), so accept either form.
        candidates = [got]
        if got.startswith("u:"):
            candidates.append(unquote(got[2:]))
        matched = False
        for c in candidates:  # no early exit, so timing does not reveal which form matched
            matched |= hmac.compare_digest(c.encode("utf-8"), expected.encode("utf-8"))
        return matched

    def do_OPTIONS(self):
        """CORS preflight: tells the browser which origins, methods and headers are allowed."""
        if self.path not in ("/api/sync", "/api/backup"):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        self.send_response(204)
        origin = self._allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Sync-Token")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _handle_backup(self):
        """POST /api/backup. No body (or no "date"): list the restore points.
        {"date": "YYYY-MM-DD"}: return that day's saved copy of all the data."""
        if not self._check_token():
            self._discard_body()
            self._send_json(401, {"error": "invalid or missing X-Sync-Token"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = json.loads(self.rfile.read(min(max(length, 0), 4096)) or b"{}")
        except ValueError:
            self._send_json(400, {"error": "invalid request"})
            return
        date = body.get("date") if isinstance(body, dict) else None
        if date is None:
            with data_lock:
                backups = list_backups()
            self._send_json(200, {"backups": backups})
            return
        # ASCII digits only (\d would also accept other scripts' digits); this also rules out any path tricks.
        if not isinstance(date, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", date):
            self._send_json(400, {"error": "date must look like 2026-10-08"})
            return
        path = BACKUP_DIR / f"sync_data-{date}.json"
        # Files are read under the lock (a save may be pruning old ones), but replies are sent
        # after releasing it so a slow client cannot hold up syncing.
        with data_lock:
            if not path.is_file():
                status, payload = 404, {"error": "no backup for that date"}
            else:
                try:
                    with path.open("r", encoding="utf-8") as f:
                        payload = {"date": date, "collections": json.load(f)}
                    status = 200
                except (OSError, ValueError):
                    status, payload = 500, {"error": "that backup could not be read"}
        self._send_json(status, payload)

    def do_POST(self):
        """Runs the POST handler; an unexpected error becomes a clean 500 reply instead of a dropped connection."""
        try:
            self._do_POST()
        except Exception as err:  # noqa: BLE001 (anything at all must still get an answer)
            print(f"ERROR: {err!r}", file=sys.stderr)
            try:
                self._send_json(500, {"error": "server error"})
            except Exception:  # noqa: BLE001 (the connection may already be gone)
                pass

    def _do_POST(self):
        """Routes POSTs: /api/backup goes to _handle_backup; /api/sync validates
        the request, merges each collection under the lock, saves, and replies
        with the merged data and any conflicts."""
        if self.path == "/api/backup":
            self._handle_backup()
            return
        if self.path != "/api/sync":
            self._discard_body()
            self._send_json(404, {"error": "not found"})
            return
        if not self._check_token():
            self._discard_body()
            self._send_json(401, {"error": "invalid or missing X-Sync-Token"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            self._send_json(400, {"error": "invalid Content-Length"})
            return
        if length < 0 or length > 50 * 1024 * 1024:
            self._send_json(413, {"error": "payload too large"})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}", parse_constant=_reject_constant)
        except ValueError:  # JSONDecodeError and UnicodeDecodeError
            self._send_json(400, {"error": "invalid JSON"})
            return
        if not isinstance(body, dict):
            self._send_json(400, {"error": "invalid payload"})
            return

        # Only the manual-sync app (clientVersion 2+) may write. Older cached
        # copies re-sent every record on a timer and kept forking duplicates.
        if not isinstance(body.get("clientVersion"), int) or body["clientVersion"] < 2:
            self._send_json(426, {"error": "This copy of the app is out of date. Close and reopen it, then tap Sync now."})
            return

        client_collections = body.get("collections")
        if not isinstance(client_collections, dict):
            self._send_json(400, {"error": "invalid payload: 'collections' must be an object"})
            return

        with data_lock:
            dataset = load_dataset()
            all_conflicts = []
            for name in COLLECTION_NAMES:
                incoming = client_collections.get(name)
                if isinstance(incoming, list):
                    for conflict in merge_collection(dataset[name], incoming, name):
                        all_conflicts.append({"collection": name, **conflict})
            save_dataset(dataset)
            response_collections = {name: dataset[name] for name in COLLECTION_NAMES}

        self._send_json(200, {"collections": response_collections, "conflicts": all_conflicts})

    def do_GET(self):
        """No GET endpoints exist; everything is POST."""
        self._send_json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        """Silences the default per-request logging."""
        pass


def main():
    """Starts the server: requires SYNC_TOKEN, makes sure the data file exists, then serves forever."""
    token = os.environ.get("SYNC_TOKEN", "").strip()
    if not token:
        print("FATAL: SYNC_TOKEN environment variable is not set. Set it in "
              "the Render dashboard before starting this service.", file=sys.stderr)
        sys.exit(1)

    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as err:
        print(f"FATAL: cannot use the data folder {DATA_DIR} ({err}). Set DATA_DIR to a folder "
              "this service can write to.", file=sys.stderr)
        sys.exit(1)
    print(f"Using data directory: {DATA_DIR} (temporary on Render's free plan: devices re-send "
          "their data after a reset)")

    if not DATA_PATH.exists():
        save_dataset(empty_dataset())

    server = ThreadingHTTPServer(("0.0.0.0", PORT), SyncHandler)
    server.sync_token = token
    print(f"Budget sync server listening on 0.0.0.0:{PORT} (plain HTTP; "
          f"TLS terminated by Render).")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
