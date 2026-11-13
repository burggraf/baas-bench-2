FROM node:24.11.0-bookworm-slim@sha256:76d0ed0ed93bed4f4376211e9d8fddac4d8b3fbdb54cc45955696001a3c91152
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      amd64) checksum=a04d3a071c274b57c6592a65d1d03466ee11adf141ebb50bfcf9d986ead2026a ;; \
      arm64) checksum=b512d2ea90b4d64d30d0472761ee4853eded914f71ea8b3468d6334d0feedc3a ;; \
      *) exit 1 ;; esac \
    && curl -fL --retry 0 -o /tmp/pocketbase.zip "https://ganigeorgiev.com/api/files/pbc_953728200/nlcqgjut5l420og/pocketbase_0.42.2_linux_${TARGETARCH}.zip" \
    && echo "$checksum  /tmp/pocketbase.zip" | sha256sum -c - \
    && unzip /tmp/pocketbase.zip pocketbase -d /app && rm /tmp/pocketbase.zip
COPY pb_migrations /app/pb_migrations
WORKDIR /app
CMD ["/app/pocketbase", "serve", "--http=0.0.0.0:4000", "--dir=/app/pb_data", "--migrationsDir=/app/pb_migrations"]
