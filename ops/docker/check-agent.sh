#!/bin/sh
set -eu

# Manual paid smoke against the same authenticated Go route used by the UI.
docker compose exec -T agent python - <<'PY'
import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def post(path, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = Request("http://go:8080" + path, data=json.dumps(payload).encode(), headers=headers)
    try:
        with urlopen(request, timeout=35) as response:
            return json.load(response)
    except HTTPError as error:
        raise SystemExit(f"Go API HTTP {error.code}") from None


session = post("/api/v1/demo/sessions", {"profile_id": os.environ.get("CHECK_PROFILE", "olga")})
reply = post(
    "/api/v1/chat/messages",
    {"text": "Кто мой наставник? Назови имя и контакт, укажи источник."},
    session["access_token"],
)
print(json.dumps(reply, ensure_ascii=False, indent=2))
if not reply["text"] or not reply["references"]:
    raise SystemExit("Ответ агента не содержит ссылки на источник.")
PY
