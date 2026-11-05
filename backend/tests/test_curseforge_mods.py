"""CurseForge mod file selection and dependency resolution (#52).

Run from the repo root: python -m unittest discover backend/tests
"""
import asyncio
import json
import unittest

import httpx

from backend import main


def cf_client(files_by_project, projects=None):
    """An httpx client whose CurseForge API serves files_by_project: project ID -> list of files,
    each optionally tagged with "_loader" (a modLoaderType) and "_version" (a game version)."""
    def handler(request: httpx.Request) -> httpx.Response:
        parts = request.url.path.split("/")
        if request.method == "POST" and request.url.path.endswith("/v1/mods"):
            ids = json.loads(request.content)["modIds"]
            return httpx.Response(200, json={"data": [{"id": i, "name": (projects or {}).get(i, f"Mod {i}")} for i in ids]})
        if parts[-1] == "files":
            loader = request.url.params.get("modLoaderType")
            version = request.url.params.get("gameVersion")
            files = [
                f for f in files_by_project.get(parts[-2], [])
                if (loader is None or str(f.get("_loader")) == loader)
                and (version is None or f.get("_version") == version)
            ]
            return httpx.Response(200, json={"data": files})
        return httpx.Response(404)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def run(coro):
    return asyncio.run(coro)


class NewestFileTest(unittest.TestCase):
    def test_picks_newest_matching_file(self):
        files = {"1": [
            {"id": 10, "fileDate": "2024-01-01T00:00:00Z", "_loader": 4, "_version": "1.20.1"},
            {"id": 11, "fileDate": "2024-03-01T00:00:00Z", "_loader": 4, "_version": "1.20.1"},
            {"id": 12, "fileDate": "2024-05-01T00:00:00Z", "_loader": 1, "_version": "1.20.1"},
            {"id": 13, "fileDate": "2024-06-01T00:00:00Z", "_loader": 4, "_version": "1.21"},
        ]}

        async def go():
            async with cf_client(files) as client:
                return await main.cf_newest_file(client, "1", "1.20.1", "FABRIC")
        self.assertEqual(run(go())["id"], 11)

    def test_quilt_falls_back_to_fabric_files(self):
        files = {"1": [{"id": 10, "fileDate": "2024-01-01", "_loader": 4, "_version": "1.20.1"}]}

        async def go():
            async with cf_client(files) as client:
                return await main.cf_newest_file(client, "1", "1.20.1", "QUILT")
        self.assertEqual(run(go())["id"], 10)

    def test_skips_server_packs_and_returns_none_when_nothing_fits(self):
        files = {"1": [{"id": 10, "fileDate": "2024-01-01", "_loader": 1, "_version": "1.20.1", "isServerPack": True}]}

        async def go():
            async with cf_client(files) as client:
                return await main.cf_newest_file(client, "1", "1.20.1", "FORGE")
        self.assertIsNone(run(go()))


class ClientOnlyTest(unittest.TestCase):
    def test_file_tagged_client_without_server_is_client_only(self):
        self.assertTrue(main.cf_file_is_client_only({"gameVersions": ["Client", "Fabric", "1.21.1"]}))

    def test_server_tag_or_no_tags_is_not_client_only(self):
        self.assertFalse(main.cf_file_is_client_only({"gameVersions": ["Client", "Server", "Fabric"]}))
        self.assertFalse(main.cf_file_is_client_only({"gameVersions": ["Fabric", "1.20.1"]}))

    def test_project_is_client_only_when_no_recent_file_targets_servers(self):
        client = {"gameVersions": ["Client", "1.21.1"]}
        untagged = {"gameVersions": ["1.12.2"]}
        server = {"gameVersions": ["Client", "Server", "1.21.1"]}
        self.assertTrue(main.cf_project_is_client_only({"latestFiles": [client, untagged]}))
        self.assertFalse(main.cf_project_is_client_only({"latestFiles": [client, server]}))
        self.assertFalse(main.cf_project_is_client_only({"latestFiles": [untagged]}))

    def test_newest_file_skips_client_only_files(self):
        files = {"1": [
            {"id": 10, "fileDate": "2024-01-01", "_loader": 4, "_version": "1.20.1"},
            {"id": 11, "fileDate": "2024-02-01", "_loader": 4, "_version": "1.20.1", "gameVersions": ["Client", "1.20.1"]},
        ]}

        async def go():
            async with cf_client(files) as client:
                return await main.cf_newest_file(client, "1", "1.20.1", "FABRIC")
        self.assertEqual(run(go())["id"], 10)


class RequiredDependenciesTest(unittest.TestCase):
    def test_follows_required_dependencies_only_once_each(self):
        def file(deps):
            return [{"id": 1, "fileDate": "2024", "_loader": 4, "_version": "1.20.1", "dependencies": deps}]
        files = {
            "100": file([{"modId": 200, "relationType": 3}, {"modId": 300, "relationType": 2}]),
            "200": file([{"modId": 400, "relationType": 3}, {"modId": 100, "relationType": 3}]),
            "400": file([]),
        }

        async def go():
            async with cf_client(files, {200: "Cloth Config", 400: "Architectury"}) as client:
                return await main.cf_required_dependencies(client, "100", "1.20.1", "FABRIC")
        self.assertEqual(run(go()), ["200", "400"])
        self.assertEqual(main.mod_metadata_cache["200"]["name"], "Cloth Config")


class ProjectForFileTest(unittest.TestCase):
    records = {"238222": {"file": "jei-1.20.1-forge-15.2.0.jar", "mod_id": "jei"}}

    def test_matches_recorded_file_even_when_disabled(self):
        self.assertEqual(main.cf_project_for_file("jei-1.20.1-forge-15.2.0.jar.disabled", None, self.records), "238222")

    def test_matches_a_newer_file_by_jar_mod_id(self):
        self.assertEqual(main.cf_project_for_file("jei-1.20.1-forge-15.3.0.jar", "jei", self.records), "238222")

    def test_unrelated_file_has_no_project(self):
        self.assertIsNone(main.cf_project_for_file("create-0.5.jar", "create", self.records))


if __name__ == "__main__":
    unittest.main()
