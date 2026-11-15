import json
import pathlib
import urllib.request

profiles = {"delivery": "olga", "travel": "sasha", "autoteca": "timur", "help": "maria"}


def call(port, path, token=None, payload=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data, headers)
    with urllib.request.urlopen(request, timeout=5) as response:
        return response.read()


def login(port, path, profile):
    return json.loads(call(port, path, payload={"profile_id": profile}))["access_token"]


files = sorted(pathlib.Path("tools").glob("*/demo.json"))
assert len(files) == 13
for filename in files:
    name = filename.parent.name
    fixture = json.loads(filename.read_text())
    path = "/api/v1/work-tools/" + name
    assert b'<div id="root">' in call(5192, "/work-tools/" + name)
    for team, profile in profiles.items():
        token = login(5192, path + "/demo/sessions", profile)
        page = json.loads(call(5192, path, token))
        expected = {item["id"] for item in fixture["records"] if item["team"] == team}
        assert expected, f"{name} has no workspace for {profile}"
        assert page["name"] == fixture["name"]
        assert {item["id"] for item in page["records"]} == expected
        assert all(record["team"] == team for record in page["records"])
        print(name, profile, "passed")
