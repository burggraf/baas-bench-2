FROM node:24.11.0-bookworm-slim@sha256:76d0ed0ed93bed4f4376211e9d8fddac4d8b3fbdb54cc45955696001a3c91152
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      amd64) checksum=0e1f609158ed945f809f8a02ae012aa0427129c66ebb63c1aee76f2c0309373f ;; \
      arm64) checksum=d22c66ceb67ca92b7d767f36d826e848a276bcfa3c197ead20bf87c42208984f ;; \
      *) exit 1 ;; esac \
    && curl -fL --retry 0 -o /tmp/pocketbase.zip "https://github.com/pocketbase/pocketbase/releases/download/v0.40.6/pocketbase_0.40.6_linux_${TARGETARCH}.zip" \
    && echo "$checksum  /tmp/pocketbase.zip" | sha256sum -c - \
    && unzip /tmp/pocketbase.zip pocketbase -d /app && rm /tmp/pocketbase.zip
COPY pb_migrations /app/pb_migrations
WORKDIR /app
CMD ["/app/pocketbase", "serve", "--http=0.0.0.0:4000", "--dir=/app/pb_data", "--migrationsDir=/app/pb_migrations"]
