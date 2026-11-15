set shell := ["bash", "-euo", "pipefail", "-c"]

default: check

frontend-typecheck:
	npm run typecheck --workspaces

frontend-test:
	npm test --workspaces

frontend-lint:
	npm exec -- eslint apps/web/frontend apps/extension/frontend apps/corporate-services/frontend apps/corporate-services/sites.mjs services/hr/*/frontend services/jira/frontend services/access/frontend services/confluence/frontend

frontend-format:
	npm exec -- prettier --check apps/web/frontend apps/extension/frontend apps/corporate-services/frontend apps/corporate-services/sites.mjs services/hr/*/frontend services/jira/frontend services/access/frontend services/confluence/frontend eslint.config.mjs prettier.config.mjs

frontend-build:
	npm run build --workspaces

frontend-check: frontend-format frontend-lint frontend-typecheck frontend-test frontend-build

python-check:
	cd services/ai-python && uv sync --locked && uv run --locked ruff format --check . ../../scripts/deploy && uv run --locked ruff check . ../../scripts/deploy && uv run --locked mypy . ../../scripts/deploy && uv run --locked pytest --cov=. --cov=../../scripts/deploy --cov-report=term-missing --cov-fail-under=80

go-check:
	cd services/backend-go && unformatted=$(gofmt -l .) && test -z "$unformatted" && go vet ./... && go test ./... && go test -race ./... && go test -coverprofile=coverage.out -covermode=atomic ./... && go tool cover -func=coverage.out

compose-check:
	docker compose config --quiet
	docker compose --profile hr --profile jira config --quiet
	docker compose -f docker-compose.yml -f docker-compose.server.yml --profile hr --profile jira config --quiet

repository-check:
	git diff --check
	test -f README.md
	test -f AGENTS.md
	test -f .github/workflows/ci.yml
	test -f .github/pull_request_template.md
	python3 -c "import re, subprocess; paths = subprocess.check_output(['git', 'ls-files', '-z']).decode().split(chr(0)); assert not any(re.search(r'(^|/)(dist|\.venv)/', p) for p in paths), 'Tracked build or environment artifacts'"

hr-consents-check:
	cd services/hr/consents && test -z "$(gofmt -l .)" && go vet ./... && go test -race ./...

test: frontend-test python-check go-check

lint: frontend-lint python-check go-check

format-check: frontend-format python-check go-check

typecheck: frontend-typecheck python-check go-check

build: frontend-build

check: jira-check frontend-check python-check go-check hr-consents-check repository-check compose-check

jira-check:
	cd services/jira && test -z "$(gofmt -l .)" && go vet ./... && go test -race ./...
