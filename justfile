set shell := ["bash", "-euo", "pipefail", "-c"]

default: check

# Isolated frontend and HTTP handlers; no servers, databases or paid model calls.
load-test requests="2000" workers="16":
	LOAD_REQUESTS={{quote(requests)}} LOAD_WORKERS={{quote(workers)}} sh ops/checks/load-suite.sh

load-bench:
	cd web/backend && go test ./internal/httpapi -run '^$' -bench '^BenchmarkBackend' -benchmem -benchtime=3s -cpu=1,4,16

load-frontend requests="2000" workers="16":
	LOAD_REQUESTS={{quote(requests)}} LOAD_WORKERS={{quote(workers)}} npm run test:load --workspace=@ai-buddy/web

frontend-typecheck:
	npm run typecheck --workspaces

frontend-test:
	npm test --workspaces

frontend-lint:
	npm exec -- eslint web/frontend extension/frontend ops/service-sites/frontend ops/service-sites/sites.mjs corporate-services/*/frontend tools/*/frontend

frontend-format:
	npm exec -- prettier --check web/frontend extension/frontend ops/service-sites/frontend ops/service-sites/sites.mjs corporate-services/*/frontend tools/*/frontend eslint.config.mjs prettier.config.mjs

frontend-build:
	npm run build --workspaces

frontend-check: frontend-format frontend-lint frontend-typecheck frontend-test frontend-build

python-check:
	cd ai-agent && uv sync --locked && uv run --locked ruff format --check . ../ops/deploy && uv run --locked ruff check . ../ops/deploy && uv run --locked mypy . ../ops/deploy && uv run --locked pytest --cov=. --cov=../ops/deploy --cov-report=term-missing --cov-fail-under=80

go-check:
	cd web/backend && unformatted=$(gofmt -l .) && test -z "$unformatted" && go vet ./... && go test ./... && go test -race ./... && go test -coverprofile=coverage.out -covermode=atomic ./... && go tool cover -func=coverage.out

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
	cd corporate-services/consents && test -z "$(gofmt -l .)" && go vet ./... && go test -race ./...

test: frontend-test python-check go-check

lint: frontend-lint python-check go-check

format-check: frontend-format python-check go-check

typecheck: frontend-typecheck python-check go-check

build: frontend-build

check: service-go-check frontend-check python-check go-check repository-check compose-check

jira-check:
	cd tools/jira && test -z "$(gofmt -l .)" && go vet ./... && go test -race ./...

tools-check:
	cd tools && test -z "$(gofmt -l shared confluence)" && go vet ./... && go test -race ./...

external-check:
	sh ops/checks/external-services.sh

service-go-check:
	sh ops/checks/service-go.sh
