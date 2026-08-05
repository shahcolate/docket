# docket as a container image.
#
# Two jobs, and they are different enough to state:
#
#  1. A Docker MCP Gateway interceptor. The gateway can run one as
#     `--interceptor before:docker:<image>`, which is the deployment that needs
#     no Node on the host and no `npx` fetch on the hot path of every tool call.
#
#  2. A CLI you can run against a mounted repo without installing anything:
#     `docker run --rm -v "$PWD:/work" docket check deploy change src/api.ts`
#
# Alpine + the runtime files only. Docket has zero dependencies, so there is no
# `npm install` here and nothing to audit but the source — which is the point of
# having zero dependencies in a tool that holds your agent's permissions.

FROM node:22-alpine

# Not root. An interceptor is a security control that reads untrusted tool-call
# payloads from every MCP client on the gateway; it has no business running as
# uid 0. `node` (uid 1000) ships with the base image.
WORKDIR /app

COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY templates ./templates
COPY spec ./spec

RUN ln -s /app/bin/docket.js /usr/local/bin/docket && chmod +x /app/bin/docket.js

# Where the repo gets mounted. The record is written HERE, not into the image
# layer — see docs/sandboxes.md: a sandbox is designed to be thrown away, and
# evidence that dies with the sandbox is not evidence.
WORKDIR /work
USER node

ENTRYPOINT ["docket"]
CMD ["help"]
