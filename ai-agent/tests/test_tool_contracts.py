import json
from pathlib import Path

from ai_buddy.mcp_client import CONTRACTS


def test_published_tool_schemas_match_runtime() -> None:
    bundle = json.loads(
        (Path(__file__).resolve().parents[2] / "contracts/agent-tools.json").read_text()
    )
    assert bundle == {
        name: {
            "arguments": c.arguments.model_json_schema(),
            "result": c.result.model_json_schema(),
        }
        for name, c in CONTRACTS.items()
    }


def test_openapi_schema_and_references_are_valid() -> None:
    import yaml
    from jsonschema import Draft202012Validator

    document = yaml.safe_load(
        (Path(__file__).resolve().parents[2] / "contracts/openapi.yaml").read_text()
    )
    for schema in document["components"]["schemas"].values():
        Draft202012Validator.check_schema(schema)

    def visit(value: object) -> None:
        if isinstance(value, dict):
            if "$ref" in value:
                target = document
                for part in value["$ref"].removeprefix("#/").split("/"):
                    target = target[part]
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    visit(document)
