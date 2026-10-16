#!/usr/bin/env python3
"""Open and close ServiceNow change requests from a CI/CD pipeline.

Uses only the standard library, so it runs on any GitHub Actions runner.

Credentials come from the environment (never from arguments, so they stay out of logs):
    SN_INSTANCE   instance name, e.g. "dev12345" for dev12345.service-now.com
    SN_USER       integration user
    SN_PASSWORD   its password

Usage:
    servicenow_change.py create --summary "Deploy checkout 1.4.0" --description "..."
    servicenow_change.py close  --sys-id <id> --result success|failed
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

TABLE_PATH = "/api/now/table/change_request"
RETRIES = 3


class ServiceNowError(RuntimeError):
    pass


def build_create_payload(summary, description="", risk="moderate", change_type="normal"):
    """Fields for a new change request. Adjust to your instance's change model."""
    if not summary or not summary.strip():
        raise ValueError("summary is required")
    return {
        "short_description": summary.strip(),
        "description": description,
        "type": change_type,
        "risk": risk,
    }


def build_close_payload(result, notes=""):
    """Fields to close a change. 'success' maps to close code 'successful'."""
    if result not in ("success", "failed"):
        raise ValueError("result must be 'success' or 'failed'")
    return {
        "state": "3",  # Closed
        "close_code": "successful" if result == "success" else "unsuccessful",
        "close_notes": notes or f"Deployment {result} (updated by CI/CD pipeline)",
    }


def _request(method, url, user, password, payload=None):
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    last_error = None
    for attempt in range(1, RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as err:
            # 4xx means our request is wrong: retrying will not help.
            if err.code < 500:
                raise ServiceNowError(f"ServiceNow returned HTTP {err.code} for {method} {url}") from err
            last_error = err
        except urllib.error.URLError as err:
            last_error = err
        time.sleep(min(2 ** attempt, 8))
    raise ServiceNowError(f"ServiceNow unreachable after {RETRIES} attempts: {last_error}")


def create_change(instance, user, password, summary, description="", risk="moderate"):
    url = f"https://{instance}.service-now.com{TABLE_PATH}"
    body = _request("POST", url, user, password, build_create_payload(summary, description, risk))
    result = body["result"]
    return {"sys_id": result["sys_id"], "number": result.get("number", "")}


def close_change(instance, user, password, sys_id, result, notes=""):
    url = f"https://{instance}.service-now.com{TABLE_PATH}/{sys_id}"
    body = _request("PATCH", url, user, password, build_close_payload(result, notes))
    return {"sys_id": body["result"]["sys_id"], "state": body["result"].get("state", "")}


def _write_github_output(values):
    path = os.getenv("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            for key, value in values.items():
                fh.write(f"{key}={value}\n")


def _credentials():
    missing = [k for k in ("SN_INSTANCE", "SN_USER", "SN_PASSWORD") if not os.getenv(k)]
    if missing:
        raise ServiceNowError(f"missing environment variables: {', '.join(missing)}")
    return os.environ["SN_INSTANCE"], os.environ["SN_USER"], os.environ["SN_PASSWORD"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create", help="open a change request")
    create.add_argument("--summary", required=True)
    create.add_argument("--description", default="")
    create.add_argument("--risk", default="moderate")

    close = sub.add_parser("close", help="close a change request")
    close.add_argument("--sys-id", required=True)
    close.add_argument("--result", required=True, choices=["success", "failed"])
    close.add_argument("--notes", default="")

    args = parser.parse_args(argv)
    try:
        instance, user, password = _credentials()
        if args.command == "create":
            out = create_change(instance, user, password, args.summary, args.description, args.risk)
            _write_github_output({"change_sys_id": out["sys_id"], "change_number": out["number"]})
            print(f"Created change {out['number'] or out['sys_id']}")
        else:
            out = close_change(instance, user, password, args.sys_id, args.result, args.notes)
            print(f"Closed change {out['sys_id']} as {args.result}")
    except (ServiceNowError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
