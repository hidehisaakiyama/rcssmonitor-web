#!/bin/sh
# Captures rcssmonitor showing a game log, without a display, for comparing
# its drawing with rcssmonitor-web (see tools/parity/README.md).
#
#   tools/parity/capture.sh LOG OUT.png [KEYS]
#
# KEYS are pressed before the capture (see rfb_snapshot.py), e.g. "Right*150,v".
# rcssmonitor runs on Qt's "vnc" platform plugin with a new, empty HOME, so
# it uses its default settings and does not touch ~/.rcssmonitor.conf.
#
# Environment: RCSSMONITOR (default: rcssmonitor), RCSSMONITOR_ARGS (extra
# options, e.g. "--grid-step 10"), SIZE (window size, default 1000x720),
# PORT (VNC port, default 5911).
set -eu

if [ $# -lt 2 ]; then
  sed -n '2,14p' "$0"
  exit 1
fi
log=$1
out=$2
keys=${3:-}
rcssmonitor=${RCSSMONITOR:-rcssmonitor}
size=${SIZE:-1000x720}
port=${PORT:-5911}
here=$(dirname "$0")

home=$(mktemp -d "${TMPDIR:-/tmp}/rcssmonitor-home.XXXXXX")
HOME=$home QT_QPA_PLATFORM="vnc:size=$size:port=$port" \
  "$rcssmonitor" --show-menu-bar off --geometry "$size+0+0" ${RCSSMONITOR_ARGS:-} "$log" \
  >"$home/rcssmonitor.log" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; rm -rf "$home"' EXIT

# Wait for the VNC server and for the log to be opened.
i=0
until grep -q 'opened rcg file' "$home/rcssmonitor.log" 2>/dev/null; do
  i=$((i + 1))
  if [ $i -gt 100 ]; then
    cat "$home/rcssmonitor.log" >&2
    echo "rcssmonitor did not open the log" >&2
    exit 1
  fi
  sleep 0.1
done
sleep 1

python3 -I "$here/rfb_snapshot.py" 127.0.0.1 "$port" "$out" "$keys"
