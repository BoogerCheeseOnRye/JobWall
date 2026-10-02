#!/usr/bin/env bash
# Start (or restart) JobWall on :8999
set -u
PIDFILE=/tmp/jobwall.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  kill "$(cat "$PIDFILE")"; sleep 0.4
fi
cd "$(dirname "$0")"
nohup node server.js > /tmp/jobwall.log 2>&1 &
echo $! > "$PIDFILE"
sleep 1
echo "started pid $(cat "$PIDFILE") -> http://localhost:${PORT:-8999}"