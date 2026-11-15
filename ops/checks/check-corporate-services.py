import json
import urllib.error
import urllib.request

HR_ENDPOINTS = {
    5181: "absence-summary",
    5182: "travel-summary",
    5183: "referral-summary",
    5184: "offboarding",
    5185: "consents",
    5186: "benefit-summary",
    5187: "documents",
    5188: "events",
}


def call(port: int, path: str, token: str = "", profile: str = "") -> bytes:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = json.dumps({"profile_id": profile}).encode() if profile else None
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", body, headers)
    with urllib.request.urlopen(request, timeout=5) as response:
        return response.read()


def login(port: int, prefix: str = "/api/v1", profile: str = "olga") -> str:
    session = json.loads(call(port, prefix + "/demo/sessions", profile=profile))
    assert session["profile_id"] == profile
    return session["access_token"]


def assert_denied(port: int, path: str, token: str, code: int) -> None:
    try:
        call(port, path, token)
    except urllib.error.HTTPError as error:
        assert error.code == code, error
    else:
        raise AssertionError(f"{port}{path} accepted an unauthorized request")


def main() -> None:
    for port, endpoint in HR_ENDPOINTS.items():
        assert b'<div id="root">' in call(port, "/")
        result = json.loads(call(port, "/hr-api/v1/me/" + endpoint, login(port)))
        assert isinstance(result, (dict, list))
        print(f"{endpoint} passed")

    assert_denied(5182, "/hr-api/v1/me/travel-summary", login(5181), 401)
    for port, prefix, path in (
        (5189, "/jira-api/v1", "/jira-api/v1/spaces"),
        (5190, "/api/v1", "/api/v1/portal-access/catalog"),
        (5191, "/api/v1", "/api/v1/confluence/pages"),
    ):
        assert b'<div id="root">' in call(port, "/")
        assert json.loads(call(port, path, login(port, prefix)))
        print(f"{port}{path} passed")

    assert_denied(5191, "/api/v1/confluence/pages/team-travel", login(5191), 404)


if __name__ == "__main__":
    main()
