"""Download the series-consistency validation images (network, validation only).

Usage: python3 fetch.py <cache-dir>

Reads dataset.json next to this file, asks the Wikimedia Commons API for a 512px
thumbnail of every listed file, and writes <cache-dir>/<group>/<NN>.<ext> plus a
.json sidecar with the title, page URL, author and license. Nothing here runs at
generation time, and the skill never downloads these files.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "imagegen-swarm-validation/1.0 (https://github.com/Ekko237/imagegen-swarm)"
HERE = os.path.dirname(os.path.abspath(__file__))


def get(url):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except Exception as exc:  # retry transient network errors
            error = exc
            time.sleep(3 * (attempt + 1))
    raise error


def strip_html(text):
    return re.sub(r"<[^>]+>", "", text or "").strip()


def info(titles):
    params = {"action": "query", "titles": "|".join(titles), "prop": "imageinfo",
              "iiprop": "url|extmetadata|mime", "iiurlwidth": 512, "format": "json"}
    data = json.loads(get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)))
    found = {}
    normalized = {item["to"]: item["from"] for item in data["query"].get("normalized", [])}
    for page in data["query"]["pages"].values():
        title = normalized.get(page["title"], page["title"])
        found[title] = page.get("imageinfo", [None])[0]
    return found


def main():
    cache = sys.argv[1]
    dataset = json.load(open(os.path.join(HERE, "dataset.json"), encoding="utf-8"))
    for group in dataset["groups"]:
        folder = os.path.join(cache, group["id"])
        os.makedirs(folder, exist_ok=True)
        meta = info(group["files"])
        for index, title in enumerate(group["files"]):
            item = meta.get(title)
            if not item:
                print("missing", title, file=sys.stderr)
                continue
            ext = ".png" if item["thumburl"].lower().endswith(".png") else ".jpg"
            target = os.path.join(folder, f"{index:02d}{ext}")
            if not os.path.exists(target):
                with open(target, "wb") as handle:
                    handle.write(get(item["thumburl"]))
                time.sleep(0.3)
            extmeta = item.get("extmetadata", {})
            sidecar = {
                "title": title, "page": item.get("descriptionurl"),
                "license": strip_html(extmeta.get("LicenseShortName", {}).get("value")),
                "license_url": extmeta.get("LicenseUrl", {}).get("value"),
                "artist": strip_html(extmeta.get("Artist", {}).get("value")),
            }
            with open(os.path.join(folder, f"{index:02d}.json"), "w", encoding="utf-8") as handle:
                json.dump(sidecar, handle, indent=1, ensure_ascii=False)
        print(group["id"], len(group["files"]))


if __name__ == "__main__":
    main()
