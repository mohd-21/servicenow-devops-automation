import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import servicenow_change as sn  # noqa: E402


def fake_response(payload):
    resp = mock.MagicMock()
    resp.read.return_value = json.dumps(payload).encode()
    resp.__enter__.return_value = resp
    return resp


class PayloadTests(unittest.TestCase):
    def test_create_payload(self):
        p = sn.build_create_payload("  Deploy v1  ", "details", risk="low")
        self.assertEqual(p["short_description"], "Deploy v1")
        self.assertEqual(p["risk"], "low")
        self.assertEqual(p["type"], "normal")

    def test_create_requires_summary(self):
        with self.assertRaises(ValueError):
            sn.build_create_payload("   ")

    def test_close_payload_maps_result(self):
        self.assertEqual(sn.build_close_payload("success")["close_code"], "successful")
        self.assertEqual(sn.build_close_payload("failed")["close_code"], "unsuccessful")
        self.assertEqual(sn.build_close_payload("success")["state"], "3")

    def test_close_rejects_unknown_result(self):
        with self.assertRaises(ValueError):
            sn.build_close_payload("maybe")


class ApiTests(unittest.TestCase):
    @mock.patch("servicenow_change.urllib.request.urlopen")
    def test_create_change_sends_auth_and_returns_ids(self, urlopen):
        urlopen.return_value = fake_response({"result": {"sys_id": "abc", "number": "CHG0030001"}})
        out = sn.create_change("dev1", "bot", "pw", "Deploy v1")
        self.assertEqual(out, {"sys_id": "abc", "number": "CHG0030001"})

        req = urlopen.call_args[0][0]
        self.assertEqual(req.full_url, "https://dev1.service-now.com/api/now/table/change_request")
        self.assertEqual(req.get_method(), "POST")
        self.assertTrue(req.headers["Authorization"].startswith("Basic "))
        self.assertEqual(json.loads(req.data)["short_description"], "Deploy v1")

    @mock.patch("servicenow_change.urllib.request.urlopen")
    def test_close_change_patches_the_record(self, urlopen):
        urlopen.return_value = fake_response({"result": {"sys_id": "abc", "state": "3"}})
        sn.close_change("dev1", "bot", "pw", "abc", "success")
        req = urlopen.call_args[0][0]
        self.assertEqual(req.get_method(), "PATCH")
        self.assertTrue(req.full_url.endswith("/change_request/abc"))

    @mock.patch("servicenow_change.time.sleep")
    @mock.patch("servicenow_change.urllib.request.urlopen")
    def test_retries_server_errors_then_succeeds(self, urlopen, _sleep):
        err = urllib.error.HTTPError("u", 503, "unavailable", {}, io.BytesIO(b""))
        urlopen.side_effect = [err, fake_response({"result": {"sys_id": "x", "number": "CHG1"}})]
        out = sn.create_change("dev1", "bot", "pw", "Deploy")
        self.assertEqual(out["sys_id"], "x")
        self.assertEqual(urlopen.call_count, 2)

    @mock.patch("servicenow_change.urllib.request.urlopen")
    def test_client_errors_are_not_retried(self, urlopen):
        urlopen.side_effect = urllib.error.HTTPError("u", 401, "unauthorized", {}, io.BytesIO(b""))
        with self.assertRaises(sn.ServiceNowError):
            sn.create_change("dev1", "bot", "bad", "Deploy")
        self.assertEqual(urlopen.call_count, 1)

    @mock.patch("servicenow_change.time.sleep")
    @mock.patch("servicenow_change.urllib.request.urlopen")
    def test_gives_up_after_retries(self, urlopen, _sleep):
        urlopen.side_effect = urllib.error.URLError("down")
        with self.assertRaises(sn.ServiceNowError):
            sn.create_change("dev1", "bot", "pw", "Deploy")
        self.assertEqual(urlopen.call_count, sn.RETRIES)


class CliTests(unittest.TestCase):
    def test_missing_credentials_exit_code(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(sn.main(["create", "--summary", "x"]), 1)

    @mock.patch("servicenow_change.urllib.request.urlopen")
    def test_create_writes_github_output(self, urlopen):
        urlopen.return_value = fake_response({"result": {"sys_id": "abc", "number": "CHG7"}})
        import tempfile

        with tempfile.NamedTemporaryFile("r+", delete=False) as out:
            env = {"SN_INSTANCE": "dev1", "SN_USER": "u", "SN_PASSWORD": "p", "GITHUB_OUTPUT": out.name}
            with mock.patch.dict(os.environ, env, clear=True):
                self.assertEqual(sn.main(["create", "--summary", "Deploy"]), 0)
            out.seek(0)
            text = out.read()
        os.unlink(out.name)
        self.assertIn("change_sys_id=abc", text)
        self.assertIn("change_number=CHG7", text)


if __name__ == "__main__":
    unittest.main()
