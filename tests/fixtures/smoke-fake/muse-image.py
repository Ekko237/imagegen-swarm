import os
import json
import sys

with open(os.environ["SWARM_FAKE_CALLS"], "a", encoding="utf8") as log:
    log.write(json.dumps({"event": "muse:list-chats" if "--list-chats" in sys.argv else "muse:generate"}) + "\n")
if "--list-chats" in sys.argv:
    print(json.dumps({"status": "error", "reason": "fixture not logged in"}))
    sys.exit(1)
raise AssertionError("Muse generation should never be called when its probe fails")
