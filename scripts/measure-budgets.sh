#!/usr/bin/env bash
# U8 budget measurement entry point (RON-301).
#
# Usage:
#   scripts/measure-budgets.sh size
#     Installer payload bytes (fully automatic, no display needed).
#   scripts/measure-budgets.sh adapter-fetch <fixture-dir> [repeats=3]
#     Headless git-stage timing through the real GitAdapter (no display).
#   scripts/measure-budgets.sh smoke <fixture-dir>
#     Full SMOKE flow (diff + scroll gaps) in the built app. NEEDS A DISPLAY
#     and pops a window — coordinate with the machine owner first. Leaves the
#     app running and prints its PID for the ram step; close it when done.
#   scripts/measure-budgets.sh ram <launcher-pid>
#     RSS sum (KiB) of a process tree, best-effort via /proc.
#
# Cold start is NOT scripted here — U8b defines an honest proxy first.
# Every mode prints the machine profile header; numbers without it are
# not evidence.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUDGET_INSTALLER_MIB=20

profile() {
	echo "profile: $(uname -srm) | $(git -C "$REPO" rev-parse --short HEAD) | $(date -u +%FT%TZ)";
}

mode="${1:-}"; shift || true

case "$mode" in
size)
	profile
	payload="$(ls "$REPO"/build/stable-linux-x64/hmmagainagain/Resources/*.tar.zst | head -1)"
	bytes="$(stat -c %s "$payload")"
	mib="$(awk "BEGIN {printf \"%.1f\", $bytes/1024/1024}")"
	echo "payload: $payload"
	echo "bytes=$bytes MiB=$mib budget=${BUDGET_INSTALLER_MIB}MiB"
	awk "BEGIN {exit !($bytes <= $BUDGET_INSTALLER_MIB*1024*1024)}" \
		&& echo "verdict=MEET" || echo "verdict=MISS"
	;;
adapter-fetch)
	dir="${1:?fixture dir required}"; repeats="${2:-3}"
	profile
	for i in $(seq 1 "$repeats"); do
		bun -e "
import { createGitAdapter } from '$REPO/src/bun/git-adapter';
const t0 = Date.now();
const r = await createGitAdapter().diff('$dir', {});
console.log('run=$i bytes=' + r.patch.length + ' files=' + r.files.length + ' ms=' + (Date.now() - t0));
" | sed "s/run=\$i/run=$i/"
	done
	;;
smoke)
	dir="${1:?fixture dir required}"
	profile
	echo "refreshing installed app from this build..."
	"$REPO"/build/stable-linux-x64/hmmagainagain/bin/launcher >/dev/null 2>&1 &
	refresh_pid=$!
	sleep 8; kill "$refresh_pid" 2>/dev/null || true
	# NOTE: never match our own command line with pkill -f here (self-kill).
	installed="$(find "$HOME/.local/share/dev.hmmagainagain.app" -name launcher -type f -newermt '-30 minutes' 2>/dev/null | head -1)"
	if [ -z "$installed" ]; then echo "no freshly extracted launcher found" >&2; exit 1; fi
	echo "installed=$installed"
	# Log-file + poll: the launcher may detach, which closes pipes early.
	log="$(mktemp /tmp/smoke-XXXXXX.log)"
	SMOKE=1 SMOKE_ROOT="$dir" "$installed" >"$log" 2>&1 &
	app_pid=$!
	for _ in $(seq 1 90); do
		sleep 2
		grep -q "SMOKE. ok=" "$log" 2>/dev/null && break
	done
	grep -E "SMOKE" "$log" || tail -5 "$log"
	echo "app_pid=$app_pid log=$log"
	echo "close the app window (kill $app_pid) when done"
	;;
ram)
	pid="${1:?launcher pid required}"
	profile
	total=0
	for p in "$pid" $(pgrep -P "$pid" 2>/dev/null || true); do
		rss="$(awk '/VmRSS/ {print $2}' "/proc/$p/status" 2>/dev/null || echo 0)"
		total=$((total + rss));
	done
	echo "pid_tree_rss_KiB=$total budget=153600KiB"
	;;
coldstart)
	runs="${1:-10}"
	profile
	installed="$(find "$HOME/.local/share/dev.hmmagainagain.app" -name launcher -type f -newermt '-60 minutes' 2>/dev/null | head -1)"
	if [ -z "$installed" ]; then echo "no recently extracted launcher found" >&2; exit 1; fi
	echo "installed=$installed (each run pops a window for ~2s)"
	for i in $(seq 1 "$runs"); do
		# NOTE: [p] keeps pkill from matching this script's own command line.
		pkill -f "hmmagainagain/ap[p]" 2>/dev/null || true
		sleep 1
		log="$(mktemp /tmp/coldstart-XXXXXX.log)"
		start_ns="$(date +%s%N)"
		"$installed" >"$log" 2>&1 &
		for _ in $(seq 1 15); do
			sleep 1
			grep -q "started! wall=" "$log" 2>/dev/null && break
		done
		wall="$(grep -o "started! wall=[0-9]*" "$log" | grep -o "[0-9]*" | head -1 || true)"
		internal="$(grep -o "started! wall=[0-9]* +[0-9]*ms" "$log" | grep -o "+[0-9]*ms" | head -1 || echo "?")"
		frame="$(grep -o "first-frame wall=[0-9]*" "$log" | grep -o "[0-9]*" | head -1 || echo "ABSENT")"
		if [ -n "$wall" ]; then
			exec_ms="$(awk "BEGIN {printf \"%.0f\", ($wall*1000000 - $start_ns)/1000000}")"
		else
			exec_ms="?"
		fi
		echo "run=$i exec_to_main_ms=$exec_ms main_internal=$internal first_frame=$frame"
		pkill -f "hmmagainagain/ap[p]" 2>/dev/null || true
	done
	;;
*)
	echo "usage: $0 {size|adapter-fetch|smoke|ram}" >&2; exit 1 ;;
esac
