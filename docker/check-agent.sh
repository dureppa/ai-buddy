#!/bin/sh
set -eu

docker compose exec -T agent python - <<'PY'
import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4


def post(url, payload, token=None, timeout=120):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = Request(url, data=json.dumps(payload).encode(), headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except HTTPError as error:
        if url.endswith("/turns"):
            raise SystemExit(f"Agent HTTP {error.code}: {error.read(4096).decode()}") from None
        raise


# Warm the model outside the agent's existing 25-second turn budget.
post(
    "http://127.0.0.1:11434/api/chat",
    {
        "model": os.environ["OLLAMA_MODEL"],
        "messages": [{"role": "user", "content": "Ответь ОК."}],
        "think": False,
        "stream": False,
        "options": {"num_ctx": 4096, "num_predict": 4},
    },
)
response = post(
    "http://127.0.0.1:8001/internal/v1/turns",
    {
        "request_id": str(uuid4()),
        "conversation_id": str(uuid4()),
        "message": "Кто мой наставник? Назови имя и контакт, укажи источник.",
        "delegation_token": os.environ["MCP_DEMO_TOKEN"],
    },
    token=os.environ["AI_SERVICE_TOKEN"],
    timeout=35,
)
reply = response["reply"]
print(json.dumps(reply, ensure_ascii=False, indent=2))
if not reply["text"] or not reply["references"]:
    raise SystemExit("Ответ агента не содержит ссылки на демонстрационный источник.")
PY
