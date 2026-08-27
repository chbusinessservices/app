FROM node:20

WORKDIR /app

# Install dependencies from the lockfile. --ignore-scripts skips the project's
# command-guard preinstall hook and native postinstall builds (web-only target).
COPY package.json yarn.lock .npmrc ./
RUN yarn install --frozen-lockfile --ignore-scripts --network-timeout 600000

EXPOSE 8081

CMD ["npx", "expo", "start", "--web", "--port", "8081", "--host", "lan"]
