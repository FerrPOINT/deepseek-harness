# syntax=docker/dockerfile:1
FROM node@sha256:e0e989b967dacc279681ed81774b2ce9eeebbb0efb8e0c427573235bebf1eda1

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=dsh-fleet-npm,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
    && ./node_modules/.bin/dsh --version

ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"

# Bundles from the same source revision as the private Fleet transport.
COPY agent-loop.mjs /app/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js
COPY sdk-server.mjs /app/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server/lib/index.js
COPY fleet/ /app/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server/src/fleet/

ENV PATH="/app/node_modules/.bin:${PATH}" \
    DSH_HOME=/data \
    HOME=/data
USER node
ENTRYPOINT ["node", "/app/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server/src/fleet/serve.mjs", "/etc/dsh/fleet.json"]
