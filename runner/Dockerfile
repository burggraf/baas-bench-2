FROM grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34 AS k6
FROM node:24.11.0-bookworm-slim@sha256:76d0ed0ed93bed4f4376211e9d8fddac4d8b3fbdb54cc45955696001a3c91152
COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY scripts/conformance.js ./scripts/conformance.js
COPY tests/conformance.js ./tests/conformance.js
CMD ["k6", "run", "/scripts/conformance.js"]
