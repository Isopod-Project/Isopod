"""Rollback suggestions for crash suspects: recorded versions, dependencies, and cases with too little evidence."""
import io
import json
import os
import tempfile
import unittest
import zipfile

from backend import rollback


def fabric_jar(mod_id: str, version: str, depends=None, nested=None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        meta = {"id": mod_id, "name": mod_id.title(), "version": version,
                "depends": {"minecraft": "*", "fabricloader": ">=0.15", **{d: "*" for d in depends or []}}}
        if nested:
            meta["jars"] = [{"file": f"META-INF/jars/{n}.jar"} for n in nested]
            for n, data in nested.items():
                z.writestr(f"META-INF/jars/{n}.jar", data)
        z.writestr("fabric.mod.json", json.dumps(meta))
    return buf.getvalue()


def forge_jar(mod_id: str, version: str, depends=None) -> bytes:
    buf = io.BytesIO()
    deps = "".join(f'\n[[dependencies.{mod_id}]]\nmodId="{d}"\nmandatory=true\n' for d in depends or [])
    deps += f'\n[[dependencies.{mod_id}]]\nmodId="minecraft"\nmandatory=true\n'
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("META-INF/mods.toml", f'modLoader="javafml"\n[[mods]]\nmodId="{mod_id}"\nversion="${{file.jarVersion}}"\ndisplayName="{mod_id.title()}"\n{deps}')
        z.writestr("META-INF/MANIFEST.MF", f"Manifest-Version: 1.0\nImplementation-Version: {version}\n")
    return buf.getvalue()


COMPOSE = "services:\n  mc:\n    environment:\n      VERSION: '{version}'\n      TYPE: FABRIC\n      MODRINTH_PROJECTS: '{projects}'\n"


class Instance:
    """An instance folder with a mods dir and snapshots built from jar dicts."""

    def __init__(self, test: unittest.TestCase):
        tmp = tempfile.TemporaryDirectory()
        test.addCleanup(tmp.cleanup)
        self.path = tmp.name
        self.mods_dir = os.path.join(self.path, "data", "mods")
        os.makedirs(self.mods_dir)

    def install(self, jars: dict) -> None:
        for name in os.listdir(self.mods_dir):
            os.remove(os.path.join(self.mods_dir, name))
        for name, data in jars.items():
            with open(os.path.join(self.mods_dir, name), "wb") as f:
                f.write(data)

    def snapshot(self, name: str, jars: dict, version="1.21.1", projects="", created=100.0) -> dict:
        zip_path = os.path.join(self.path, name)
        with zipfile.ZipFile(zip_path, "w") as z:
            for fname, data in jars.items():
                z.writestr(f"data/mods/{fname}", data)
            z.writestr("docker-compose.yml", COMPOSE.format(version=version, projects=projects))
        mods, env = rollback.read_snapshot(zip_path, "data/mods")
        return {"name": name, "reason": "Before changing mods", "created": created, "mods": mods, "env": env, "path": zip_path}

    def current(self) -> dict:
        return rollback.read_mods_dir(self.mods_dir)


ENV = {"VERSION": "1.21.1", "TYPE": "FABRIC"}


class ReadJarTests(unittest.TestCase):
    def test_fabric_dependencies_skip_the_game_and_loader(self):
        info = rollback.read_jar(fabric_jar("sodium", "0.6.0", ["fabric-api"]), "sodium-0.6.0.jar")
        self.assertEqual((info["id"], info["version"], info["depends"]), ("sodium", "0.6.0", ["fabric-api"]))

    def test_forge_version_placeholder_comes_from_the_manifest(self):
        info = rollback.read_jar(forge_jar("create", "6.0.1", ["flywheel"]), "create-6.0.1.jar")
        self.assertEqual((info["id"], info["version"], info["depends"]), ("create", "6.0.1", ["flywheel"]))

    def test_bundled_libraries_count_as_provided(self):
        info = rollback.read_jar(fabric_jar("a", "1", ["lib"], nested={"lib": fabric_jar("lib", "2")}), "a.jar")
        self.assertIn("lib", info["provides"])

    def test_unreadable_jar_falls_back_to_the_file_name(self):
        info = rollback.read_jar(b"not a zip", "Cool-Mod-1.2.3.jar")
        self.assertEqual((info["id"], info["version"]), ("cool-mod", "1.2.3"))

    def test_modrinth_pins(self):
        self.assertEqual(rollback.modrinth_entry_id("sodium:AbCd1234"), "sodium")
        self.assertEqual(rollback.modrinth_entry_id("sodium"), "sodium")
        env = rollback.pin_modrinth({"MODRINTH_PROJECTS": "sodium,lithium:ZZZZ9999"}, {"sodium": "AbCd1234", "lithium": "Y1y1y1y1"})
        self.assertEqual(env["MODRINTH_PROJECTS"], "sodium:AbCd1234,lithium:Y1y1y1y1")


class SuggestTests(unittest.TestCase):
    def setUp(self):
        self.inst = Instance(self)

    def test_updated_suspect_suggests_the_recorded_version_with_its_evidence(self):
        snap = self.inst.snapshot("snapshot-1.zip", {"sodium-0.5.jar": fabric_jar("sodium", "0.5")})
        self.inst.install({"sodium-0.6.jar": fabric_jar("sodium", "0.6")})
        [s] = rollback.suggest(["sodium-0.6.jar"], self.inst.current(), [snap], ENV)
        self.assertEqual(s["status"], "previous_version")
        self.assertEqual((s["current"], s["previous"]), ("0.6", "0.5"))
        self.assertEqual(s["snapshot"]["name"], "snapshot-1.zip")
        self.assertIn("changed from 0.5 to 0.6", s["reason"])
        self.assertTrue(s["available"])
        self.assertEqual([m["id"] for m in s["group"]], ["sodium"])

    def test_forge_style_suspect_names_match_by_mod_id(self):
        snap = self.inst.snapshot("snapshot-1.zip", {"create-5.jar": forge_jar("create", "5.0")})
        self.inst.install({"create-6.jar": forge_jar("create", "6.0")})
        [s] = rollback.suggest(["Create (create)"], self.inst.current(), [snap], {**ENV, "TYPE": "FABRIC"})
        self.assertEqual((s["status"], s["previous"]), ("previous_version", "5.0"))

    def test_uses_the_newest_snapshot_where_the_mod_differs(self):
        older = self.inst.snapshot("snapshot-1.zip", {"a-1.jar": fabric_jar("a", "1")}, created=50)
        newer = self.inst.snapshot("snapshot-2.zip", {"a-2.jar": fabric_jar("a", "2")}, created=90)
        self.inst.install({"a-3.jar": fabric_jar("a", "3")})
        [s] = rollback.suggest(["a"], self.inst.current(), [newer, older], ENV)
        self.assertEqual((s["previous"], s["snapshot"]["name"]), ("2", "snapshot-2.zip"))

    def test_dependencies_that_changed_with_the_suspect_roll_back_together(self):
        snap = self.inst.snapshot("snapshot-1.zip", {
            "a-1.jar": fabric_jar("a", "1", ["lib"]), "lib-1.jar": fabric_jar("lib", "1"),
            "b-1.jar": fabric_jar("b", "1", ["a"]), "other-1.jar": fabric_jar("other", "1"),
        })
        self.inst.install({
            "a-2.jar": fabric_jar("a", "2", ["lib"]), "lib-2.jar": fabric_jar("lib", "2"),
            "b-2.jar": fabric_jar("b", "2", ["a"]), "other-1.jar": fabric_jar("other", "1"),
        })
        [s] = rollback.suggest(["a"], self.inst.current(), [snap], ENV)
        self.assertEqual(sorted(m["id"] for m in s["group"]), ["a", "b", "lib"])

    def test_a_dependency_removed_since_the_snapshot_is_restored_too(self):
        snap = self.inst.snapshot("snapshot-1.zip", {"a-1.jar": fabric_jar("a", "1", ["lib"]), "lib-1.jar": fabric_jar("lib", "1")})
        self.inst.install({"a-2.jar": fabric_jar("a", "2")})
        [s] = rollback.suggest(["a"], self.inst.current(), [snap], ENV)
        lib = next(m for m in s["group"] if m["id"] == "lib")
        self.assertIsNone(lib["current"])

    def test_a_different_minecraft_version_blocks_the_rollback(self):
        snap = self.inst.snapshot("snapshot-1.zip", {"a-1.jar": fabric_jar("a", "1")}, version="1.20.1")
        self.inst.install({"a-2.jar": fabric_jar("a", "2")})
        [s] = rollback.suggest(["a"], self.inst.current(), [snap], ENV)
        self.assertEqual(s["status"], "previous_version")
        self.assertFalse(s["available"])
        self.assertIn("1.20.1", s["blockers"][0])

    def test_curseforge_and_modpack_mods_show_history_but_cant_be_held(self):
        snap = self.inst.snapshot("snapshot-1.zip", {"a-1.jar": fabric_jar("a", "1")})
        self.inst.install({"a-2.jar": fabric_jar("a", "2")})
        cf = {"123": {"file": "a-2.jar", "mod_id": "a"}}
        [s] = rollback.suggest(["a"], self.inst.current(), [snap], ENV, cf)
        self.assertFalse(s["available"])
        self.assertIn("CurseForge", s["blockers"][0])
        [s] = rollback.suggest(["a"], self.inst.current(), [snap], {**ENV, "MODRINTH_MODPACK": "pack"})
        self.assertIn("modpack", s["blockers"][0])

    def test_modrinth_mods_are_flagged_for_pinning(self):
        snap = self.inst.snapshot("snapshot-1.zip", {"sodium-1.jar": fabric_jar("sodium", "1")})
        self.inst.install({"sodium-2.jar": fabric_jar("sodium", "2")})
        [s] = rollback.suggest(["sodium"], self.inst.current(), [snap], {**ENV, "MODRINTH_PROJECTS": "sodium"})
        self.assertTrue(s["available"])
        self.assertTrue(s["group"][0]["modrinth"])
        self.assertTrue(any("pinned" in n for n in s["notes"]))

    def test_no_snapshot_means_no_guess(self):
        self.inst.install({"a-2.jar": fabric_jar("a", "2")})
        [s] = rollback.suggest(["a"], self.inst.current(), [], ENV)
        self.assertEqual(s["status"], "no_history")
        self.assertNotIn("previous", s)
        self.assertFalse(s["available"])

    def test_mod_added_after_the_snapshot_has_no_previous_version(self):
        snap = self.inst.snapshot("snapshot-1.zip", {})
        self.inst.install({"a-2.jar": fabric_jar("a", "2")})
        [s] = rollback.suggest(["a"], self.inst.current(), [snap], ENV)
        self.assertEqual(s["status"], "added")
        self.assertFalse(s["available"])

    def test_unchanged_mod_says_rolling_back_wont_help(self):
        jar = fabric_jar("a", "1")
        snap = self.inst.snapshot("snapshot-1.zip", {"a-1.jar": jar})
        self.inst.install({"a-1.jar": jar})
        [s] = rollback.suggest(["a"], self.inst.current(), [snap], ENV)
        self.assertEqual(s["status"], "unchanged")

    def test_unmatched_suspect_is_reported_as_such(self):
        self.inst.install({"a-1.jar": fabric_jar("a", "1")})
        [s] = rollback.suggest(["Mystery Mod (mystery)"], self.inst.current(), [], ENV)
        self.assertEqual(s["status"], "unmatched")

    def test_several_changed_suspects_say_one_may_not_be_enough(self):
        snap = self.inst.snapshot("snapshot-1.zip", {"a-1.jar": fabric_jar("a", "1"), "b-1.jar": fabric_jar("b", "1")})
        self.inst.install({"a-2.jar": fabric_jar("a", "2"), "b-2.jar": fabric_jar("b", "2")})
        suggestions = rollback.suggest(["a", "b"], self.inst.current(), [snap], ENV)
        self.assertEqual(len(suggestions), 2)
        for s in suggestions:
            self.assertTrue(any("Several suspects" in n for n in s["notes"]))

    def test_mod_changes_lists_added_removed_and_updated(self):
        snap = self.inst.snapshot("snapshot-1.zip", {"a-1.jar": fabric_jar("a", "1"), "gone-1.jar": fabric_jar("gone", "1")})
        self.inst.install({"a-2.jar": fabric_jar("a", "2"), "new-1.jar": fabric_jar("new", "1")})
        changes = {c["id"]: c["change"] for c in rollback.mod_changes(self.inst.current(), snap["mods"])}
        self.assertEqual(changes, {"a": "updated", "gone": "removed", "new": "added"})


class SwapTests(unittest.TestCase):
    def test_swap_restores_the_recorded_jar_and_keeps_disabled_mods_disabled(self):
        inst = Instance(self)
        snap = inst.snapshot("snapshot-1.zip", {"a-1.jar": fabric_jar("a", "1"), "b-1.jar": fabric_jar("b", "1", ["a"])})
        inst.install({"a-2.jar": fabric_jar("a", "2"), "b-2.jar.disabled": fabric_jar("b", "2", ["a"])})
        current = inst.current()
        [s] = rollback.suggest(["a"], current, [snap], ENV)
        jars = rollback.read_previous_jars(snap["path"], s["group"], snap["mods"])
        written = rollback.swap_jars(inst.mods_dir, s["group"], current, jars)
        self.assertEqual(sorted(written), ["a-1.jar", "b-1.jar.disabled"])
        self.assertEqual(sorted(os.listdir(inst.mods_dir)), ["a-1.jar", "b-1.jar.disabled"])
        self.assertEqual(inst.current()["a"]["version"], "1")


class EndpointTests(unittest.TestCase):
    """The crash report's suggestions and the rollback action, through main."""

    def setUp(self):
        import asyncio
        from unittest import mock
        import httpx
        from backend import backups, main
        self.asyncio, self.main, self.backups = asyncio, main, backups
        self.inst = Instance(self)
        self.path = self.inst.path
        with open(os.path.join(self.path, "docker-compose.yml"), "w") as f:
            f.write(COMPOSE.format(version="1.21.1", projects="sodium,lithium"))
        self.old = fabric_jar("sodium", "0.5")
        self.inst.install({"sodium-0.5.jar": self.old, "lithium-1.jar": fabric_jar("lithium", "1")})
        self.snapshot = backups.create_snapshot(self.path, "Before changing mods")
        self.inst.install({"sodium-0.6.jar": fabric_jar("sodium", "0.6"), "lithium-1.jar": fabric_jar("lithium", "1")})

        def modrinth(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/v2/version_files":
                hashes = json.loads(request.content)["hashes"]
                return httpx.Response(200, json={h: {"id": "AbCd1234", "project_id": "AANobbMI"} for h in hashes})
            return httpx.Response(200, json=[{"id": "AANobbMI", "slug": "sodium"}])

        real_client = httpx.AsyncClient
        for target, kwargs in (
            (mock.patch.object(main, "get_instance_path", return_value=self.path), {}),
            (mock.patch.object(main, "is_instance_running", return_value=False), {}),
            (mock.patch.object(main.httpx, "AsyncClient", side_effect=lambda **kw: real_client(transport=httpx.MockTransport(modrinth))), {}),
        ):
            target.start()
            self.addCleanup(target.stop)

    def test_suggestions_for_a_crash_report(self):
        info = self.main.mod_rollback_suggestions("pack", ["sodium-0.6.jar"], time_after(self.snapshot))
        [s] = info["suggestions"]
        self.assertEqual((s["status"], s["previous"], s["snapshot"]["name"]), ("previous_version", "0.5", self.snapshot["name"]))
        self.assertEqual(info["changes"], [{"id": "sodium", "name": "Sodium", "change": "updated", "previous": "0.5", "current": "0.6"}])

    def test_rollback_swaps_the_jar_pins_modrinth_and_snapshots_first(self):
        req = self.main.ModRollbackRequest(mod_id="sodium", snapshot=self.snapshot["name"])
        result = self.asyncio.run(self.main.rollback_crash_mod("pack", req))
        self.assertEqual(result["restored"], [{"name": "Sodium", "version": "0.5"}])
        self.assertEqual(sorted(os.listdir(self.inst.mods_dir)), ["lithium-1.jar", "sodium-0.5.jar"])
        with open(os.path.join(self.inst.mods_dir, "sodium-0.5.jar"), "rb") as f:
            self.assertEqual(f.read(), self.old)
        self.assertEqual(self.main.read_compose_env(self.path)["MODRINTH_PROJECTS"], "sodium:AbCd1234,lithium")
        reasons = [s["reason"] for s in self.backups.list_snapshots(self.path)]
        self.assertIn("Before rolling back Sodium", reasons)
        # The rollback's own snapshot holds the crashing jar; it's never offered as the earlier version
        info = self.main.mod_rollback_suggestions("pack", ["sodium"], 2**40)
        self.assertEqual(info["suggestions"][0]["status"], "unchanged")

    def test_rollback_refuses_a_stale_snapshot_name(self):
        from fastapi import HTTPException
        req = self.main.ModRollbackRequest(mod_id="lithium", snapshot=self.snapshot["name"])
        with self.assertRaises(HTTPException) as caught:
            self.asyncio.run(self.main.rollback_crash_mod("pack", req))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("sodium-0.6.jar", os.listdir(self.inst.mods_dir))


def time_after(snapshot: dict) -> float:
    return snapshot["created"] + 1


if __name__ == "__main__":
    unittest.main()
