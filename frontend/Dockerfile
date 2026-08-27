# syntax=docker/dockerfile:1.7
FROM node:20

WORKDIR /app

# Install dependencies from the lockfile. BuildKit cache mount keeps the yarn
# download cache across rebuilds. --ignore-scripts skips the project's
# command-guard preinstall hook and native postinstall builds (web-only target).
COPY package.json yarn.lock .npmrc ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --ignore-scripts --network-timeout 600000

# Skip non-essential Expo startup work (telemetry, git-status, update checks)
# so the dev server reaches a listening state faster.
ENV EXPO_NO_TELEMETRY=1 \
    EXPO_NO_GIT_STATUS=1 \
    EXPO_NO_UPDATE=1

EXPOSE 8081

CMD ["npx", "expo", "start", "--web", "--port", "8081", "--host", "lan"]
