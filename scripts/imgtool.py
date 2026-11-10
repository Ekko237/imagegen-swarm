import hashlib
import json
import sys

from PIL import Image

# 各引擎脚本共用的图片小工具（跨平台，依赖 Pillow）：
#   png <输入> <输出>   转成真正的 PNG
#   size <文件>         宽高
#   fp <文件>...        解码后像素的 sha256：同一张图换了格式也认得出；一次可传多个文件


def fingerprint(path):
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        return hashlib.sha256(f"{rgba.width}x{rgba.height}".encode() + rgba.tobytes()).hexdigest()


def main():
    command, path = sys.argv[1], sys.argv[2]
    if command == "fp":
        print(json.dumps({"fp": [fingerprint(item) for item in sys.argv[2:]]}))
        return
    with Image.open(path) as image:
        if command == "png":
            image.save(sys.argv[3], "PNG")
            result = {"width": image.width, "height": image.height}
        elif command == "size":
            result = {"width": image.width, "height": image.height}
        else:
            raise SystemExit(f"unknown command: {command}")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
