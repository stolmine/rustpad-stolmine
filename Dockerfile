FROM rust:alpine AS backend
WORKDIR /home/rust/src
RUN apk --no-cache add musl-dev openssl-dev

# Cache dependencies: copy manifests first, build with dummy source
COPY Cargo.toml Cargo.lock ./
COPY rustpad-server/Cargo.toml rustpad-server/
COPY rustpad-wasm/Cargo.toml rustpad-wasm/
# Migrations needed for sqlx::migrate!() macro at compile time
COPY rustpad-server/migrations rustpad-server/migrations
RUN mkdir -p rustpad-server/src rustpad-wasm/src && \
    echo "fn main() {}" > rustpad-server/src/main.rs && \
    echo "" > rustpad-wasm/src/lib.rs && \
    cargo build --release --package rustpad-server && \
    rm -rf rustpad-server/src rustpad-wasm/src

# Now copy actual source and build (dependencies cached)
COPY rustpad-server/src rustpad-server/src
COPY rustpad-wasm/src rustpad-wasm/src
RUN touch rustpad-server/src/main.rs && cargo build --release --package rustpad-server

FROM --platform=amd64 rust:alpine AS wasm
WORKDIR /home/rust/src
RUN apk --no-cache add curl musl-dev
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Cache dependencies for wasm
COPY Cargo.toml Cargo.lock ./
COPY rustpad-server/Cargo.toml rustpad-server/
COPY rustpad-wasm/Cargo.toml rustpad-wasm/
RUN mkdir -p rustpad-server/src rustpad-wasm/src && \
    echo "fn main() {}" > rustpad-server/src/main.rs && \
    echo "" > rustpad-wasm/src/lib.rs && \
    cargo build --release --package rustpad-wasm && \
    rm -rf rustpad-server/src rustpad-wasm/src

# Now copy actual source and build
COPY rustpad-wasm/src rustpad-wasm/src
COPY rustpad-server/src rustpad-server/src
RUN wasm-pack build rustpad-wasm

FROM --platform=amd64 node:lts-alpine AS frontend
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
COPY --from=wasm /home/rust/src/rustpad-wasm/pkg rustpad-wasm/pkg
RUN npm ci
COPY . .
ARG GITHUB_SHA
ENV VITE_SHA=${GITHUB_SHA}
RUN npm run check
RUN npm run build

FROM alpine:latest
RUN mkdir -p /data && chown 1000:1000 /data
WORKDIR /app
COPY --from=frontend /usr/src/app/dist dist
COPY --from=backend /home/rust/src/target/release/rustpad-server .
USER 1000:1000
CMD [ "./rustpad-server" ]
