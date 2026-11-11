#!/bin/sh
# Portable Lovart `lv` wrapper.
# Copy this file to ~/tools/lovart-skill/lv (the root of the official clone) and chmod +x it.
# It loads ~/.lovart/env and execs skills/lovart-skill/scripts/agent_skill.py.
#
# The credentials file should be owner-only (mode 600). The mode check uses GNU stat (-c)
# and, if that is not available, BSD stat (-f), so the same file works on Linux and macOS.
# If the mode cannot be read, the wrapper still runs the CLI. A permissions-check failure
# must not replace a real API error such as no credits.
set -eu

ENV_FILE=${LOVART_ENV:-"$HOME/.lovart/env"}

if [ ! -f "$ENV_FILE" ]; then
  echo "Lovart credentials file not found: $ENV_FILE" >&2
  exit 1
fi

# GNU coreutils: stat -c %a. BSD/macOS: stat -f %Lp (octal mode). %A is a last resort.
mode=$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE" 2>/dev/null || stat -f %A "$ENV_FILE" 2>/dev/null || true)
case $mode in
  ''|*[!0-9]*)
    ;;
  *)
    # Last two digits are the group and other bits. 600 and 700 are owner-only; 644 is not.
    last2=$(printf '%s' "$mode" | tail -c 2)
    if [ "$last2" != "00" ]; then
      echo "Refusing to run: $ENV_FILE is mode $mode. Expected owner-only permissions such as 600." >&2
      exit 1
    fi
    ;;
esac

# shellcheck disable=SC1090
. "$ENV_FILE"

ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
AGENT=${LOVART_AGENT_SKILL:-"$ROOT/skills/lovart-skill/scripts/agent_skill.py"}
exec python3 "$AGENT" "$@"
