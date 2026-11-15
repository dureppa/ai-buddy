FROM golang:1.26.11-alpine AS build
ARG MODULE=web/backend
ARG ENTRY=./cmd/server
WORKDIR /src/${MODULE}
COPY ${MODULE}/go.mod ${MODULE}/go.sum ./
COPY tools/go.mod tools/go.sum /src/tools/
COPY tools/shared/ /src/tools/shared/
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY ${MODULE}/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 go build -trimpath -o /server "$ENTRY"

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /server /usr/local/bin/server
USER 65534:65534
ENTRYPOINT ["/usr/local/bin/server"]
