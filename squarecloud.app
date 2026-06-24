DISPLAY_NAME=Bot Vendas Telegram
RUNTIME=nodejs
MAIN=scripts/production-server.mjs
START=npm run build:square && npm run start
MEMORY=1024
VERSION=recommended
AUTORESTART=true
SUBDOMAIN=botvendassl
