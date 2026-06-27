DISPLAY_NAME=CriaBot
RUNTIME=nodejs
MAIN=scripts/production-server.mjs
START=npm run build:square && npm run start
MEMORY=1024
VERSION=recommended
AUTORESTART=true
SUBDOMAIN=criabot
