"""Fail closed if any required CI job is missing, repeated, or unsuccessful."""

import json
import sys
from pathlib import Path

REQUIRED = {"frontend", "python", "go", "repository"}


def check_jobs(value: object) -> None:
    if not isinstance(value, dict) or not isinstance(value.get("jobs"), list):
        raise TypeError("invalid CI response")
    jobs = value["jobs"]
    if value.get("total_count") != len(jobs):
        raise ValueError("CI response is incomplete")
    for name in REQUIRED:
        matching = [
            job for job in jobs if isinstance(job, dict) and job.get("name") == name
        ]
        if (
            len(matching) != 1
            or matching[0].get("conclusion") != "success"
            or matching[0].get("status") != "completed"
        ):
            raise ValueError("required CI job did not succeed: " + name)


if __name__ == "__main__":
    check_jobs(json.loads(Path(sys.argv[1]).read_text()))
