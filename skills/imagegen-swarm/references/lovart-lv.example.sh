#!/bin/sh
# Optional Lovart wrapper. lovart.mjs runs scripts/lovart_agent.py directly.
# This file reads the three named keys from ~/.lovart/env and execs that shipped client.
# It does not source the file.
# Set LOVART_AGENT_SKILL if this wrapper is copied out of the skill folder.
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

# Read only the named Lovart keys. Do not source the file.
read_named() {
  key=$1
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | head -n 1 || true)
  [ -n "$line" ] || return 0
  val=${line#*=}
  val=$(printf '%s' "$val" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  case $val in
    \"*\") val=$(printf '%s' "$val" | sed 's/^"//; s/"$//') ;;
    \'*\') val=$(printf '%s' "$val" | sed "s/^'//; s/'$//") ;;
  esac
  export "$key=$val"
}
read_named LOVART_ACCESS_KEY
read_named LOVART_SECRET_KEY
read_named LOVART_BASE_URL

if [ -n "${LOVART_AGENT_SKILL:-}" ]; then
  AGENT=$LOVART_AGENT_SKILL
else
  AGENT=$(CDPATH= cd -- "$(dirname "$0")/../scripts" && pwd)/lovart_agent.py
fi
if [ ! -f "$AGENT" ]; then
  echo "Lovart client not found: $AGENT" >&2
  exit 1
fi
exec python3 "$AGENT" "$@"
