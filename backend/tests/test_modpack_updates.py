"""Checking a Modrinth modpack for updates and switching its version."""
import json
import os
import tempfile
import time
import unittest
from unittest import mock

import yaml
from fastapi.testclient import TestClient

from backend import main, modpacks


def version(version_id, number, published, mc="1.21.1", version_type="release"):
    return {
        "id": version_id,
        "name": f"Pack {number}",
        "version_number": number,
        "version_type": version_type,
        "game_versions": [mc],
        "loaders": ["fabric"],
        "date_published": published,
        "changelog": f"Changes in {number}",
        "files": [],
    }


OLD = version("old11111", "1.0.0", "2026-01-01T00:00:00Z", mc="1.20.1")
NEW = version("new22222", "2.0.0", "2026-03-01T00:00:00Z")
BETA = version("beta3333", "3.0.0-beta", "2026-05-01T00:00:00Z", version_type="beta")
# Newest first, as get_project stores them
VERSIONS = [BETA, NEW, OLD]
PROJECT = {"id": "projid", "slug": "my-pack", "title": "My Pack", "description": "A pack", "icon_url": None}


def cdn_file(project, ver, filename, server="required"):
    return {
        "path": f"mods/{filename}",
        "env": {"client": "required", "server": server},
        "downloads": [f"https://cdn.modrinth.com/data/{project}/versions/{ver}/{filename}"],
        "hashes": {"sha1": "abc"},
    }


class VersionLogicTests(unittest.TestCase):
    def test_version_is_found_by_id_or_number(self):
        self.assertIs(modpacks.find_version(VERSIONS, "new22222"), NEW)
        self.assertIs(modpacks.find_version(VERSIONS, "2.0.0"), NEW)
        self.assertIsNone(modpacks.find_version(VERSIONS, "gone"))
        self.assertIsNone(modpacks.find_version(VERSIONS, None))

    def test_release_is_not_offered_a_newer_beta(self):
        self.assertIs(modpacks.latest_for(VERSIONS, OLD), NEW)

    def test_beta_is_offered_a_newer_beta(self):
        older_beta = version("beta0000", "1.5.0-beta", "2026-02-01T00:00:00Z", version_type="beta")
        self.assertIs(modpacks.latest_for(VERSIONS, older_beta), BETA)

    def test_unknown_current_version_is_never_an_update(self):
        self.assertFalse(modpacks._is_newer(NEW, None))

    def test_older_version_is_not_an_update(self):
        self.assertFalse(modpacks._is_newer(OLD, NEW))
        self.assertFalse(modpacks._is_newer(NEW, NEW))
        self.assertTrue(modpacks._is_newer(NEW, OLD))


class MergeExcludesTests(unittest.TestCase):
    INDEX = {"files": [
        cdn_file("sodiumproj", "v2", "sodium-2.jar"),
        cdn_file("foo", "v2", "foo-2.jar"),
        cdn_file("bar", "v2", "bar-2.jar"),
        cdn_file("clientonly", "v2", "hud-2.jar", server="unsupported"),
    ]}

    def merge(self, previous, old_mods):
        new_mods = modpacks.mods_from_index(self.INDEX)
        return modpacks.merge_excludes(self.INDEX, previous, old_mods, new_mods)

    def test_client_only_mods_of_the_new_version_are_excluded(self):
        self.assertCountEqual(self.merge([], []), ["sodium-2.jar", "hud-2.jar"])

    def test_a_mod_the_user_excluded_stays_excluded_under_its_new_filename(self):
        merged = self.merge(["foo-1.jar"], [{"filename": "foo-1.jar", "project_id": "foo"}])
        self.assertIn("foo-2.jar", merged)
        self.assertNotIn("bar-2.jar", merged)

    def test_filenames_the_new_version_lacks_are_dropped(self):
        self.assertNotIn("foo-1.jar", self.merge(["foo-1.jar"], []))

    def test_partial_names_the_user_typed_stay(self):
        self.assertIn("somemod", self.merge(["somemod"], []))

    def test_no_duplicates_even_with_different_case(self):
        merged = self.merge(["SODIUM-2.jar"], [])
        self.assertEqual(len([x for x in merged if x.lower() == "sodium-2.jar"]), 1)

    def test_removed_mods_stay_hidden_in_the_new_list(self):
        new_mods = modpacks.mods_from_index(self.INDEX)
        modpacks.carry_removed([{"filename": "foo-1.jar", "project_id": "foo", "removed": True}], new_mods)
        self.assertTrue(next(m for m in new_mods if m["project_id"] == "foo")["removed"])
        self.assertNotIn("removed", next(m for m in new_mods if m["project_id"] == "bar"))


class ImageTests(unittest.TestCase):
    def test_java_tag_follows_the_minecraft_version(self):
        self.assertEqual(main.image_for_mc_version("itzg/minecraft-server:java17", "1.21.1"), "itzg/minecraft-server:java21")
        self.assertEqual(main.image_for_mc_version("itzg/minecraft-server", "1.20.1"), "itzg/minecraft-server:java17")

    def test_a_variant_of_the_right_java_is_kept(self):
        self.assertEqual(main.image_for_mc_version("itzg/minecraft-server:java21-graalvm", "1.21.1"), "itzg/minecraft-server:java21-graalvm")

    def test_other_images_are_left_alone(self):
        self.assertEqual(main.image_for_mc_version("example/custom:1", "1.21.1"), "example/custom:1")


class ModpackEndpointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "packy")
        os.makedirs(os.path.join(self.path, "data"))
        self.write_compose()
        patches = [
            mock.patch.object(main, "SERVERS_DIR", self.tmp.name),
            mock.patch.object(main, "instance_dir", lambda name: os.path.join(self.tmp.name, name)),
            mock.patch.object(main.auth_store, "username_for", return_value="admin"),
            mock.patch.dict(modpacks._projects, {"my-pack": {"fetched": time.time(), "project": PROJECT, "versions": VERSIONS}}, clear=True),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(main.app)

    def write_compose(self, env=None, image="itzg/minecraft-server:java17"):
        environment = env if env is not None else [
            "EULA=TRUE", "TYPE=MODRINTH", "VERSION=1.20.1", "MODRINTH_MODPACK=my-pack",
            "MODRINTH_VERSION=old11111", "MODRINTH_EXCLUDE_FILES=foo-1.jar,typed",
        ]
        with open(os.path.join(self.path, "docker-compose.yml"), "w") as f:
            yaml.dump({"services": {"mc": {"image": image, "environment": environment}}}, f)

    def read_compose(self):
        with open(os.path.join(self.path, "docker-compose.yml")) as f:
            return yaml.safe_load(f)["services"]["mc"]

    def post_update(self, body=None, running=False, restart_error=None):
        index = {
            "dependencies": {"minecraft": "1.21.1", "fabric-loader": "0.16"},
            "files": [cdn_file("foo", "v2", "foo-2.jar"), cdn_file("hud", "v2", "hud-2.jar", server="unsupported")],
        }
        new_mods = [{"filename": "foo-2.jar", "project_id": "foo"}]

        async def load_target(modpack, version_id):
            found = modpacks.find_version(VERSIONS, version_id)
            if not found:
                raise modpacks.ModpackError("That version isn't part of this modpack.", 404)
            return {"version": found, "index_data": index, "mods": new_mods, "minecraft_version": "1.21.1"}

        async def start(instance_id):
            if restart_error:
                raise main.HTTPException(status_code=400, detail=restart_error)
            self.started.append(instance_id)

        self.started = []
        with mock.patch.object(modpacks, "load_target", side_effect=load_target), \
                mock.patch.object(main, "is_instance_up", return_value=running), \
                mock.patch.object(main, "stop_instance") as self.stop, \
                mock.patch.object(main, "start_instance", side_effect=start), \
                mock.patch.object(main.backups, "create_snapshot", return_value={"name": "snapshot-20260101-000000.zip", "reason": "r"}) as self.snapshot, \
                mock.patch.object(main.backups, "prune_snapshots") as self.prune:
            return self.client.post("/api/instances/packy/modpack/update", json=body or {"version_id": "new22222"})

    def test_status_reports_the_update(self):
        data = self.client.get("/api/instances/packy/modpack/status").json()
        self.assertEqual(data["project"]["title"], "My Pack")
        self.assertEqual(data["project"]["url"], "https://modrinth.com/modpack/my-pack")
        self.assertEqual(data["current"]["id"], "old11111")
        self.assertEqual(data["current"]["minecraft_version"], "1.20.1")
        self.assertEqual(data["latest"]["id"], "new22222")
        self.assertTrue(data["update_available"])
        self.assertEqual([v["id"] for v in data["versions"]], ["beta3333", "new22222", "old11111"])
        self.assertEqual(data["versions"][1]["changelog"], "Changes in 2.0.0")

    def test_status_is_a_404_for_an_instance_without_a_modpack(self):
        self.write_compose(env=["TYPE=FABRIC"])
        self.assertEqual(self.client.get("/api/instances/packy/modpack/status").status_code, 404)

    def test_status_explains_a_pack_it_cant_look_up(self):
        self.write_compose(env=["MODRINTH_MODPACK=/data/pack.mrpack"])
        res = self.client.get("/api/instances/packy/modpack/status")
        self.assertEqual(res.status_code, 400)
        self.assertIn("MODRINTH_MODPACK", res.json()["detail"])

    def test_unpinned_pack_uses_the_installed_version(self):
        self.write_compose(env=["MODRINTH_MODPACK=my-pack"])
        with open(os.path.join(self.path, "data", ".modrinth-modpack-manifest.json"), "w") as f:
            json.dump({"versionId": "new22222"}, f)
        data = self.client.get("/api/instances/packy/modpack/status").json()
        self.assertEqual(data["current"]["id"], "new22222")
        self.assertFalse(data["update_available"])

    def test_badge_data_comes_from_the_cache_without_api_calls(self):
        data_dir = os.path.join(self.path, "data")
        with mock.patch.object(modpacks.httpx, "AsyncClient") as client:
            self.assertEqual(modpacks.cached_update(data_dir, "my-pack", "old11111"), {"current": "1.0.0", "latest": "2.0.0"})
            self.assertIsNone(modpacks.cached_update(data_dir, "my-pack", "new22222"))
            self.assertIsNone(modpacks.cached_update(data_dir, "never-checked", "old11111"))
            self.assertIsNone(modpacks.cached_update(data_dir, None, None))
        client.assert_not_called()

    def test_update_rewrites_the_compose_file(self):
        res = self.post_update()
        self.assertEqual(res.status_code, 200)
        service = self.read_compose()
        env = dict(item.split("=", 1) for item in service["environment"])
        self.assertEqual(env["MODRINTH_VERSION"], "new22222")
        self.assertEqual(env["VERSION"], "1.21.1")
        self.assertEqual(env["MODRINTH_FORCE_SYNCHRONIZE"], "true")
        self.assertEqual(env["ISOPOD_MODPACK_LOADER"], "FABRIC")
        self.assertCountEqual(env["MODRINTH_EXCLUDE_FILES"].split(","), ["hud-2.jar", "typed"])
        self.assertEqual(env["EULA"], "TRUE")
        self.assertEqual(service["image"], "itzg/minecraft-server:java21")
        self.assertEqual(res.json()["image"], service["image"])
        self.assertEqual(res.json()["environment"]["MODRINTH_VERSION"], "new22222")

    def test_update_saves_the_new_mod_list(self):
        self.post_update()
        self.assertEqual(modpacks.load_saved(self.path, "new22222")["mods"][0]["filename"], "foo-2.jar")

    def test_update_keeps_a_mapping_environment_a_mapping(self):
        self.write_compose(env={"MODRINTH_MODPACK": "my-pack", "MODRINTH_VERSION": "old11111"})
        self.post_update()
        self.assertEqual(self.read_compose()["environment"]["MODRINTH_VERSION"], "new22222")

    def test_backup_is_always_a_fresh_snapshot(self):
        recent = {"name": "snapshot-20250101-000000.zip", "reason": "old"}
        with mock.patch.object(main.backups, "recent_snapshot", return_value=recent):
            res = self.post_update()
        self.snapshot.assert_called_once()
        self.assertEqual(res.json()["snapshot"]["name"], "snapshot-20260101-000000.zip")
        self.assertEqual(main.get_instance_meta(self.path)["pending_snapshot"]["name"], "snapshot-20260101-000000.zip")

    def test_backup_is_kept_even_with_snapshots_turned_off(self):
        main.save_instance_meta(self.path, {"backups": {"snapshot_keep": 0}})
        self.post_update()
        self.snapshot.assert_called_once()
        self.prune.assert_called_once_with(self.path, 1)

    def test_no_backup_when_unticked(self):
        res = self.post_update({"version_id": "new22222", "backup": False})
        self.assertEqual(res.status_code, 200)
        self.snapshot.assert_not_called()
        self.assertIsNone(res.json()["snapshot"])

    def test_nothing_changes_if_the_backup_fails(self):
        before = self.read_compose()
        with mock.patch.object(main, "take_pre_update_snapshot", side_effect=main.HTTPException(status_code=500, detail="disk full")):
            res = self.post_update()
        self.assertEqual(res.status_code, 500)
        self.assertEqual(self.read_compose(), before)

    def test_unknown_version_changes_nothing(self):
        before = self.read_compose()
        res = self.post_update({"version_id": "gone"})
        self.assertEqual(res.status_code, 404)
        self.assertEqual(self.read_compose(), before)

    def test_unsafe_version_id_is_rejected(self):
        self.assertEqual(self.post_update({"version_id": "../../etc"}).status_code, 400)

    def test_running_server_restarts_when_asked(self):
        res = self.post_update(running=True)
        self.assertTrue(res.json()["restarted"])
        self.stop.assert_called_once_with("packy")
        self.assertEqual(self.started, ["packy"])

    def test_running_server_is_left_alone_when_restart_is_off(self):
        res = self.post_update({"version_id": "new22222", "restart": False}, running=True)
        self.assertFalse(res.json()["restarted"])
        self.stop.assert_not_called()

    def test_stopped_server_stays_stopped(self):
        res = self.post_update(running=False)
        self.assertFalse(res.json()["restarted"])
        self.stop.assert_not_called()
        self.assertEqual(self.started, [])

    def test_failed_restart_is_reported_but_keeps_the_update(self):
        res = self.post_update(running=True, restart_error="port in use")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["restarted"])
        self.assertEqual(res.json()["restart_error"], "port in use")
        self.assertIn("MODRINTH_VERSION=new22222", self.read_compose()["environment"])


if __name__ == "__main__":
    unittest.main()
