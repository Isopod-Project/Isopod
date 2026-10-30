"""Bedrock allowlist and operators in User Management.

Run from the repo root: python -m unittest discover backend/tests
The endpoint tests need the backend's requirements installed; the rest only need the stdlib.
"""
import json
import os
import tempfile
import unittest
from unittest import mock

import yaml

from backend import bedrock, bedrock_users

XUID_BUILDER = "2535400000000001"
XUID_ALEX = "2535400000000002"


def no_lookup(name):
    return None


class GamertagTests(unittest.TestCase):
    def test_spaces_inside_a_gamertag_are_kept(self):
        self.assertTrue(bedrock_users.is_valid_gamertag("Blocky Builder"))
        self.assertEqual(bedrock_users.split_env_list("Blocky Builder,Alex\nSteve Two"), ["Blocky Builder", "Alex", "Steve Two"])

    def test_characters_that_break_the_list_or_command_are_rejected(self):
        for name in ['Bad"Name', "a,b", "a:b", " Leading", "Trailing ", "line\nbreak", "", "x" * 33]:
            self.assertFalse(bedrock_users.is_valid_gamertag(name), name)

    def test_allow_list_users_with_xuids(self):
        self.assertEqual(
            bedrock_users.parse_allow_list_users(f"Blocky Builder:{XUID_BUILDER},Alex"),
            [("Blocky Builder", XUID_BUILDER), ("Alex", None)],
        )

    def test_allowlist_is_on_when_the_entrypoint_would_turn_it_on(self):
        self.assertTrue(bedrock_users.allow_list_enabled({"ALLOW_LIST": "true"}))
        self.assertTrue(bedrock_users.allow_list_enabled({"ALLOW_LIST": "false", "ALLOW_LIST_USERS": "Alex"}))
        self.assertFalse(bedrock_users.allow_list_enabled({"ALLOW_LIST": "false", "ALLOW_LIST_USERS": ""}))


class LoadUsersTests(unittest.TestCase):
    def setUp(self):
        self.data_dir = tempfile.mkdtemp()

    def write(self, name, content):
        with open(os.path.join(self.data_dir, name), "w") as f:
            json.dump(content, f)

    def test_players_only_the_server_knows_about_are_added(self):
        self.write("allowlist.json", [{"name": "Alex", "xuid": XUID_ALEX, "ignoresPlayerLimit": False}])
        env = {"ALLOW_LIST_USERS": "Blocky Builder", "OPS": f"Steve,{XUID_ALEX},{'9' * 16}"}
        users, changed = bedrock_users.load_users([], self.data_dir, env)
        by_name = {u["name"]: u for u in users}
        self.assertTrue(changed)
        self.assertEqual(set(by_name), {"Blocky Builder", "Alex", "Steve"})
        self.assertTrue(by_name["Alex"]["is_op"])
        self.assertEqual(by_name["Alex"]["xuid"], XUID_ALEX)
        self.assertTrue(by_name["Steve"]["is_op"])
        self.assertFalse(by_name["Steve"]["whitelisted"])
        self.assertFalse(by_name["Blocky Builder"]["is_op"])

    def test_xuid_written_by_the_server_is_filled_in(self):
        self.write("allowlist.json", [{"name": "Blocky Builder", "xuid": XUID_BUILDER}])
        saved = [bedrock_users.new_user("Blocky Builder")]
        users, changed = bedrock_users.load_users(saved, self.data_dir, {})
        self.assertTrue(changed)
        self.assertEqual(users[0]["xuid"], XUID_BUILDER)

    def test_users_json_alone_is_unchanged(self):
        saved = [bedrock_users.new_user("Alex", whitelisted=False)]
        users, changed = bedrock_users.load_users(saved, self.data_dir, {})
        self.assertFalse(changed)
        self.assertEqual(users, saved)


class NormalizeTests(unittest.TestCase):
    def test_operators_get_an_xuid_from_known_users_or_lookup(self):
        known = [bedrock_users.new_user("Alex", XUID_ALEX)]
        lookups = []

        def lookup(name):
            lookups.append(name)
            return XUID_BUILDER

        users = bedrock_users.normalize(
            [{"name": "Alex", "is_op": True}, {"name": "Blocky Builder", "level": 4}, {"name": "Steve"}],
            known, lookup,
        )
        self.assertEqual([u["xuid"] for u in users], [XUID_ALEX, XUID_BUILDER, None])
        self.assertEqual(lookups, ["Blocky Builder"])
        self.assertTrue(all(u["level"] in (0, 4) for u in users))

    def test_bad_gamertag_is_rejected(self):
        with self.assertRaises(ValueError):
            bedrock_users.normalize([{"name": 'Evil" stop'}], [], no_lookup)

    def test_duplicates_are_dropped(self):
        users = bedrock_users.normalize([{"name": "Alex"}, {"name": "alex"}], [], no_lookup)
        self.assertEqual(len(users), 1)


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.data_dir = tempfile.mkdtemp()
        self.users = [
            bedrock_users.new_user("Blocky Builder", XUID_BUILDER, is_op=True),
            bedrock_users.new_user("Alex"),
            {**bedrock_users.new_user("Gone"), "active": False},
            bedrock_users.new_user("Steve", is_op=True, whitelisted=False),
        ]

    def test_env_while_allowlist_is_on(self):
        env = bedrock_users.access_env(self.users, True, {}, [])
        self.assertEqual(env, {
            "ALLOW_LIST": "true",
            "ALLOW_LIST_USERS": "Blocky Builder,Alex",
            "OPS": f"{XUID_BUILDER},Steve",
        })

    def test_env_while_allowlist_is_off_leaves_the_names_out(self):
        env = bedrock_users.access_env(self.users, False, {}, [])
        self.assertEqual(env["ALLOW_LIST"], "false")
        self.assertEqual(env["ALLOW_LIST_USERS"], "")

    def test_hand_added_operator_xuid_is_kept(self):
        other = "9" * 16
        env = bedrock_users.access_env([], True, {"OPS": f"{other},{XUID_BUILDER}"}, [bedrock_users.new_user("Blocky Builder", XUID_BUILDER)])
        self.assertEqual(env["OPS"], other)

    def test_access_files(self):
        other = {"permission": "member", "xuid": "9" * 16}
        with open(os.path.join(self.data_dir, "permissions.json"), "w") as f:
            json.dump([other, {"permission": "operator", "xuid": XUID_ALEX}], f)
        old = [bedrock_users.new_user("Alex", XUID_ALEX, is_op=True)]
        bedrock_users.write_access_files(self.data_dir, self.users, old)

        with open(os.path.join(self.data_dir, "allowlist.json")) as f:
            allowlist = json.load(f)
        self.assertEqual(allowlist, [
            {"ignoresPlayerLimit": False, "name": "Blocky Builder", "xuid": XUID_BUILDER},
            {"ignoresPlayerLimit": False, "name": "Alex"},
        ])
        with open(os.path.join(self.data_dir, "permissions.json")) as f:
            permissions = json.load(f)
        self.assertEqual(permissions, [other, {"permission": "operator", "xuid": XUID_BUILDER}])

    def test_last_operator_removed_empties_permissions(self):
        old = [bedrock_users.new_user("Alex", XUID_ALEX, is_op=True)]
        bedrock_users.write_access_files(self.data_dir, [bedrock_users.new_user("Alex", XUID_ALEX)], old)
        with open(os.path.join(self.data_dir, "permissions.json")) as f:
            self.assertEqual(json.load(f), [])

    def test_live_commands_quote_gamertags(self):
        old = [bedrock_users.new_user("Alex", is_op=True), bedrock_users.new_user("Old Friend")]
        new = [bedrock_users.new_user("Alex"), bedrock_users.new_user("Blocky Builder", is_op=True)]
        self.assertEqual(bedrock_users.live_commands(old, False, new, True), [
            'allowlist remove "Old Friend"',
            'allowlist add "Blocky Builder"',
            "allowlist on",
            'deop "Alex"',
            'op "Blocky Builder"',
        ])
        self.assertEqual(bedrock_users.live_commands(new, True, new, True), [])


try:
    from backend import main
except ImportError:  # backend requirements aren't installed
    main = None


@unittest.skipIf(main is None, "backend requirements not installed")
class EndpointTests(unittest.TestCase):
    """GET and PUT /users on a Bedrock instance, with Docker stubbed out."""

    def setUp(self):
        self.path = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.path, "data"))
        service = bedrock.compose_service("pocket", "Pocket", 19132, None, None, None, None, None, False, ["Blocky Builder"])
        with open(os.path.join(self.path, "docker-compose.yml"), "w") as f:
            yaml.dump({"services": {"mc": service}}, f)
        with open(os.path.join(self.path, "data", "users.json"), "w") as f:
            json.dump([bedrock_users.new_user("Blocky Builder")], f)
        self.sent = []
        self.running = True
        patches = [
            mock.patch.object(main, "get_instance_path", return_value=self.path),
            mock.patch.object(main, "is_instance_running", side_effect=lambda p: self.running),
            mock.patch.object(main.bedrock, "send_command", side_effect=lambda p, c: (self.sent.append(c), (True, ""))[1]),
            mock.patch.object(main.bedrock_users, "lookup_xuid", return_value=None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def env(self):
        return main.read_compose_env(self.path)

    def save(self, users, enabled=True):
        payload = main.UpdateUsersPayload(users=[main.WhitelistUser(**u) for u in users], whitelist_enabled=enabled)
        return main.update_instance_users("pocket", payload)

    def test_new_bedrock_server_keeps_allowlist_off_until_turned_on(self):
        self.assertEqual(self.env().get("ALLOW_LIST"), "false")
        self.assertNotIn("ALLOW_LIST_USERS", self.env())
        users, enabled = main.get_instance_users_internal("pocket")
        self.assertFalse(enabled)
        self.assertEqual([u["name"] for u in users], ["Blocky Builder"])

    def test_add_op_and_remove_on_a_running_server_persist(self):
        result = self.save([
            {"name": "Blocky Builder", "whitelisted": True},
            {"name": "Steve Two", "whitelisted": True, "is_op": True, "level": 4},
        ])
        self.assertTrue(result["whitelist_enabled"])
        self.assertEqual(self.sent, ['allowlist add "Steve Two"', "allowlist on", 'op "Steve Two"'])
        env = self.env()
        self.assertEqual(env["ALLOW_LIST_USERS"], "Blocky Builder,Steve Two")
        self.assertEqual(env["OPS"], "Steve Two")
        self.assertEqual(result["environment"]["OPS"], "Steve Two")

        # What the tab shows after a restart comes back from users.json
        users, enabled = main.get_instance_users_internal("pocket")
        self.assertTrue(enabled)
        self.assertEqual({u["name"]: u["is_op"] for u in users}, {"Blocky Builder": False, "Steve Two": True})

        self.sent.clear()
        self.save([{"name": "Steve Two", "whitelisted": True, "is_op": False}])
        self.assertEqual(self.sent, ['allowlist remove "Blocky Builder"', 'deop "Steve Two"'])
        self.assertEqual(self.env()["ALLOW_LIST_USERS"], "Steve Two")
        self.assertEqual(self.env()["OPS"], "")
        with open(os.path.join(self.path, "data", "allowlist.json")) as f:
            self.assertEqual([e["name"] for e in json.load(f)], ["Steve Two"])

    def test_stopped_server_gets_no_commands(self):
        self.running = False
        self.save([{"name": "Blocky Builder", "whitelisted": True, "is_op": True}])
        self.assertEqual(self.sent, [])
        self.assertEqual(self.env()["OPS"], "Blocky Builder")

    def test_bad_gamertag_is_a_400(self):
        with self.assertRaises(main.HTTPException) as ctx:
            self.save([{"name": 'x" && stop'}])
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
