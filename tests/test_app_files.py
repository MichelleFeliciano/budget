"""Checks that need no browser: facts about the app's own files that must stay true."""
import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / "app.js").read_text(encoding="utf-8")
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "style.css").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))

# Elements the app creates itself while running (so they are not in index.html).
CREATED_BY_APP = {"storage-warning"}

# Second Memory is served from the same web address, so nothing here may share its storage or cache names.
OWN_KEY_PREFIX = "budgetApp."


class AppFiles(unittest.TestCase):
    def test_version_label_matches_the_service_worker_cache(self):
        """APP_VERSION (shown in the Menu) must equal the number in CACHE_NAME in sw.js."""
        shown = re.search(r"const APP_VERSION = (\d+);", APP)
        cache = re.search(r"const CACHE_NAME = 'budget-v(\d+)';", SW)
        self.assertIsNotNone(shown)
        self.assertIsNotNone(cache)
        self.assertEqual(shown.group(1), cache.group(1))

    def test_no_duplicate_element_ids(self):
        ids = re.findall(r'\bid="([^"]+)"', HTML)
        self.assertEqual(sorted(i for i in set(ids) if ids.count(i) > 1), [])

    def test_every_element_the_code_looks_up_exists(self):
        """A getElementById for an id that is not in index.html would crash the app at load."""
        html_ids = set(re.findall(r'\bid="([^"]+)"', HTML))
        used = set(re.findall(r"getElementById\('([^']+)'\)", APP))
        self.assertEqual(sorted(used - html_ids - CREATED_BY_APP), [])

    def test_no_external_scripts_or_styles(self):
        """No CDN script tags, no external dependencies."""
        self.assertEqual(re.findall(r'<script[^>]+src="https?://', HTML), [])
        self.assertEqual(re.findall(r'<link[^>]+href="https?://', HTML), [])
        self.assertEqual(re.findall(r"@import|url\(\s*['\"]?https?://", CSS), [])

    def test_the_only_network_call_is_the_sync_server(self):
        """The app has exactly one fetch(), and it goes to the sync server."""
        calls = re.findall(r"fetch\(([^,)]*)", APP)
        self.assertEqual(len(calls), 1)
        self.assertIn("SYNC_SERVER_URL", calls[0])
        for banned in ("XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "importScripts"):
            self.assertNotIn(banned, APP)

    def test_every_local_file_the_page_loads_is_in_the_offline_cache(self):
        shell = set(re.findall(r"'\./([^']*)'", SW[SW.index("const APP_SHELL"):SW.index("];", SW.index("const APP_SHELL"))]))
        loaded = set(re.findall(r'(?:src|href)="(?!https?:|#|data:|mailto:)([^"]+)"', HTML))
        loaded = {x.lstrip("./") for x in loaded}
        for name in loaded:
            self.assertIn(name, shell, f"{name} is loaded by index.html but not in APP_SHELL")
        for name in shell:
            if name:
                self.assertTrue((ROOT / name).exists(), f"{name} is in APP_SHELL but missing on disk")

    def test_the_manifest_files_and_icons_are_cached_and_exist(self):
        shell = set(re.findall(r"'\./([^']*)'", SW[SW.index("const APP_SHELL"):SW.index("];", SW.index("const APP_SHELL"))]))
        self.assertIn("manifest.json", shell)
        for icon in MANIFEST["icons"]:
            self.assertTrue((ROOT / icon["src"]).exists(), icon["src"])
            self.assertIn(icon["src"], shell, f"{icon['src']} is in the manifest but not in APP_SHELL")

    def test_manifest_is_budget_with_relative_paths(self):
        """Hosted next to Second Memory (e.g. /budget/), so nothing may start with a slash or say Second Memory."""
        self.assertEqual(MANIFEST["name"], "Budget")
        self.assertEqual(MANIFEST["short_name"], "Budget")
        self.assertEqual(MANIFEST["start_url"], "./index.html")
        self.assertEqual(MANIFEST["scope"], "./")
        for value in [MANIFEST["start_url"], MANIFEST["scope"]] + [i["src"] for i in MANIFEST["icons"]]:
            self.assertFalse(value.startswith("/"), value)
            self.assertNotIn("://", value)
        self.assertNotIn("second", json.dumps(MANIFEST).lower())

    def test_page_title_and_app_name_are_budget(self):
        self.assertIn("<title>Budget</title>", HTML)
        self.assertIn('name="apple-mobile-web-app-title" content="Budget"', HTML)

    def test_service_worker_only_touches_its_own_cache_and_files(self):
        """The service worker shares its origin with Second Memory: own cache name, own files only."""
        self.assertNotIn("second-memory", SW.lower())
        self.assertNotIn("secondmemory", SW.lower())
        self.assertIn("key.startsWith('budget-') && key !== CACHE_NAME", SW)
        self.assertIn("isShellFile", SW)
        # Every cache name is budget-v<number>.
        self.assertEqual(re.findall(r"CACHE_NAME = '([^']+)'", SW), ["budget-v" + re.search(r"APP_VERSION = (\d+)", APP).group(1)])
        # Paths are relative, so they resolve under whatever folder the app is hosted in.
        shell_block = SW[SW.index("const APP_SHELL"):SW.index("];", SW.index("const APP_SHELL"))]
        for entry in re.findall(r"'([^']+)'", shell_block):
            self.assertTrue(entry.startswith("./"), entry)

    def test_service_worker_is_registered_relative_to_the_page(self):
        self.assertIn("register('./sw.js')", APP)

    def test_every_storage_key_has_the_apps_own_prefix(self):
        """localStorage is shared with Second Memory on the same site, so every key must be this app's own."""
        keys = set(re.findall(r"'([A-Za-z]+\.[A-Za-z]+\.v\d+)'", APP + HTML))
        self.assertTrue(keys, "no storage keys found")
        for key in keys:
            self.assertTrue(key.startswith(OWN_KEY_PREFIX), key)
        self.assertNotIn("secondMemory", APP + HTML + SW + CSS)
        # "Forgot PIN" may only erase this app's own keys.
        self.assertIn("key.startsWith('budgetApp.')", APP)

    def test_only_the_three_budget_lists_sync(self):
        block = APP[APP.index("const SYNC_COLLECTIONS = ["):]
        block = block[:block.index("];")]
        self.assertEqual(re.findall(r"\{ name: '(\w+)'", block), ["bills", "income", "recurringIncome"])

    def test_nothing_from_the_other_second_memory_lists_is_left(self):
        """The other lists were dropped on purpose; their code and markup must not creep back in."""
        for word in ("renderBooks", "renderRecipes", "renderMedications", "renderTodos", "renderNotes", "renderLinks",
                     "renderJournal", "renderHome", "healthSummary", "therapySummary", "cookMode", "globalSearch",
                     "quickAdd", "shoppingItems", "journalEntries"):
            self.assertNotIn(word, APP, word)
        for word in ("books-collection", "home-collection", "journal-collection", "data-tab=", "health-summary", "cook-mode"):
            self.assertNotIn(word, HTML, word)

    def test_sync_address_matches_the_deploy_config_and_the_server_lists(self):
        """The app, render.yaml and the server must agree, or sync silently goes nowhere."""
        render = (ROOT / "render.yaml").read_text(encoding="utf-8")
        server = (ROOT / "server" / "sync_server.py").read_text(encoding="utf-8")
        url = re.search(r"SYNC_SERVER_URL = '([^']+)'", APP).group(1)
        service = re.search(r"^\s*-\s*type: web\s*\n\s*name: (\S+)", render, re.M).group(1)
        self.assertEqual(url, f"https://{service}.onrender.com")
        self.assertIn("startCommand: python server/sync_server.py", render)
        # Free plan: no disk (a disk needs a paid plan), and a writable temporary data folder.
        self.assertRegex(render, r"(?m)^\s*plan: free\s*$")
        self.assertNotRegex(render, r"(?m)^\s*disk:")
        self.assertNotIn("plan: starter", render)
        self.assertRegex(render, r"key: DATA_DIR\s*\n\s*value: /tmp/")
        listed = re.search(r"COLLECTION_NAMES = \[(.*?)\]", server, re.S).group(1)
        self.assertEqual(re.findall(r'"(\w+)"', listed), ["bills", "income", "recurringIncome"])
        for other in ("second memory", "secondmemory", "second-memory"):
            self.assertNotIn(other, (server + render).lower())

    def test_no_secrets_in_the_files(self):
        """The sync passphrase is typed by the user at runtime; it is never in code, tests or docs."""
        for path in ROOT.rglob("*"):
            if path.is_file() and ".git" not in path.parts and path.suffix in {".js", ".html", ".css", ".json", ".md", ".py"}:
                text = path.read_text(encoding="utf-8")
                self.assertNotRegex(text, r"(?i)(passphrase|token|secret)\s*[:=]\s*['\"][^'\"]{6,}['\"]", str(path))
        # The saved config only ever holds what the user typed.
        self.assertIn("saveSyncConfig({ token })", APP)

    def test_every_function_has_a_comment(self):
        """The code is meant to be easy to read: every top-level function has a comment directly above it."""
        lines = APP.split("\n")
        missing = [
            f"line {i + 1}: {line[:60]}"
            for i, line in enumerate(lines)
            if re.match(r"(async )?function \w+", line) and not (lines[i - 1].strip().startswith("//") or lines[i - 1].strip().endswith("*/"))
        ]
        self.assertEqual(missing, [])

    def test_motion_overrides_come_after_the_rules_they_override(self):
        """A reduced-motion rule only wins if it sits later in the file than the animation or transition it turns off."""
        media = CSS.index("@media (prefers-reduced-motion: reduce)")
        for rule in (".bill-card-new { animation:", ".fold-summary::before {"):
            self.assertGreater(media, CSS.index(rule), rule)

    def test_theme_colours_are_readable(self):
        """Text, warnings and outlines keep their contrast (WCAG: 4.5:1 for text, 3:1 for outlines) in both themes."""

        def palette(start):
            i = CSS.index(start)
            block = CSS[i:CSS.index("}", i)]
            return dict(re.findall(r"(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})", block))

        def luminance(hex_colour):
            def channel(c):
                c /= 255
                return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
            r, g, b = (channel(int(hex_colour[i:i + 2], 16)) for i in (1, 3, 5))
            return 0.2126 * r + 0.7152 * g + 0.0722 * b

        def ratio(a, b):
            high, low = sorted((luminance(a), luminance(b)), reverse=True)
            return (high + 0.05) / (low + 0.05)

        pairs = [
            ("--text", "--bg", 4.5), ("--text", "--surface", 4.5),
            ("--muted", "--bg", 4.5), ("--muted", "--surface", 4.5),
            ("--accent", "--bg", 4.5), ("--accent", "--surface", 4.5),
            ("--accent-contrast", "--accent", 4.5),
            ("--accent-2", "--bg", 4.5), ("--accent-2", "--surface", 4.5),
            ("--accent-rose", "--bg", 4.5), ("--accent-rose", "--surface", 4.5),
            ("--border", "--bg", 3.0), ("--border", "--surface", 3.0),
        ]
        for theme, start in (("light", ":root {"), ('dark', ':root[data-theme="dark"] {')):
            colours = palette(start)
            for foreground, background, needed in pairs:
                with self.subTest(theme=theme, pair=f"{foreground} on {background}"):
                    self.assertGreaterEqual(ratio(colours[foreground], colours[background]), needed)


if __name__ == "__main__":
    unittest.main()
