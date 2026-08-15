#!/bin/sh
set -eu

umask 077
mkdir -p /data
exec node /app/dist/server/server/index.js
