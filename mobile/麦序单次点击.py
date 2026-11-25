"""从可见商品列表中辨认指定麦序，补货时打开一次。Python 3.10+，依赖 Pillow 和 numpy。"""
import argparse
import base64
import contextlib
import ctypes
import io
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


class Stop(Exception):
    """状态不明确时结束当前操作。"""


@dataclass
class Frame:
    image: Image.Image
    context: tuple


def png_image(data):
    with Image.open(io.BytesIO(data)) as image:
        return image.convert("RGB")


def image_data(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


class Windows:
    def __init__(self):
        from ctypes import wintypes
        if sys.platform != "win32":
            raise Stop("Windows 浏览器模式须在 Windows 上运行。")
        self.api = ctypes.windll.user32
        self.types = wintypes
        self.api.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        self.api.GetForegroundWindow.restype = wintypes.HWND
        self.api.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        self.api.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        self.api.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        self.api.WindowFromPoint.argtypes = [wintypes.POINT]
        self.api.WindowFromPoint.restype = wintypes.HWND
        self.api.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
        self.api.GetAncestor.restype = wintypes.HWND

    def front(self):
        window = self.api.GetForegroundWindow()
        title, kind = ctypes.create_unicode_buffer(512), ctypes.create_unicode_buffer(100)
        self.api.GetWindowTextW(window, title, len(title))
        self.api.GetClassNameW(window, kind, len(kind))
        if kind.value != "Chrome_WidgetWin_1" or "抖音直播" not in title.value:
            raise Stop("前台须是标题含「抖音直播」的 Chrome 或 Edge 直播间。")
        rect = self.types.RECT()
        if not self.api.GetWindowRect(window, ctypes.byref(rect)):
            raise Stop("读取前台窗口位置失败。")
        return window, title.value, (rect.left, rect.top, rect.right, rect.bottom)

    def grab(self):
        from PIL import ImageGrab
        context = self.front()
        image = ImageGrab.grab(bbox=context[2], all_screens=True).convert("RGB")
        if self.front() != context:
            raise Stop("截图时前台窗口发生变化。")
        return Frame(image, context)

    def tap(self, frame, x, y):
        if self.front() != frame.context:
            raise Stop("前台窗口或位置发生变化。")
        window, _, (left, top, _, _) = frame.context
        point = self.types.POINT(left + x, top + y)
        under = self.api.WindowFromPoint(point)
        if not under or self.api.GetAncestor(under, 2) != window:
            raise Stop("目标按钮被其他窗口覆盖。")
        if not self.api.SetCursorPos(point.x, point.y):
            raise Stop("无法定位鼠标。")
        current = self.types.POINT()
        under = self.api.WindowFromPoint(point)
        if (not self.api.GetCursorPos(ctypes.byref(current)) or (current.x, current.y) != (point.x, point.y)
                or self.front() != frame.context or not under or self.api.GetAncestor(under, 2) != window):
            raise Stop("点击位置或前台窗口已变化。")
        self.api.mouse_event(0x0002, 0, 0, 0, 0)
        self.api.mouse_event(0x0004, 0, 0, 0, 0)


class Android:
    package = "com.ss.android.ugc.aweme"

    def __init__(self, serial):
        self.command = ["adb", "-s", serial] if serial else ["adb", "-d"]

    def adb(self, *args):
        result = subprocess.run(self.command + list(args), capture_output=True, check=True, timeout=10)
        return result.stdout

    def front(self):
        windows = self.adb("shell", "dumpsys", "window").decode(errors="replace")
        focus = re.search(r"mCurrentFocus\s*=\s*(Window\{[^}\r\n]+\})", windows)
        if not focus or self.package + "/" not in focus[1]:
            raise Stop("无法确认前台为抖音。请保持手机解锁，并切回直播商品列表。")
        return (focus[1],)

    def grab(self):
        context = self.front()
        return Frame(png_image(self.adb("exec-out", "screencap", "-p")), context)

    def tap(self, frame, x, y):
        sizes = self.adb("shell", "wm", "size").decode(errors="replace")
        found = re.findall(r"(?:Physical|Override) size:\s*(\d+)x(\d+)", sizes)
        if not found or tuple(map(int, found[-1])) != frame.image.size:
            raise Stop("系统逻辑尺寸与截图不一致，需使用全屏竖屏。")
        if self.front() != frame.context:
            raise Stop("手机前台窗口已变化。")
        self.adb("shell", "input", "tap", str(x), str(y))


class LocalRequests(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Stop("本机 Appium 返回了重定向。")


class IPhone:
    bundle = "com.ss.iphone.ugc.Aweme"

    def __init__(self, url):
        info = urllib.parse.urlsplit(url)
        if (info.scheme != "http" or info.hostname not in {"localhost", "127.0.0.1", "::1"}
                or info.username or info.password or info.query or info.fragment
                or not re.fullmatch(r"/(?:wd/hub/)?session/[A-Za-z0-9-]+/?", info.path)):
            raise Stop("请用 --session-url 指定本机 Appium 的现有 XCUITest 会话地址。")
        self.url = url.rstrip("/")
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), LocalRequests())

    def request(self, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.url + path, data=data, headers={"Content-Type": "application/json"})
        with self.opener.open(req, timeout=12) as response:
            result = json.load(response)["value"]
        if isinstance(result, dict) and "error" in result:
            raise Stop("Appium 命令失败，本轮结束。")
        return result

    def mobile(self, command, **args):
        return self.request("/execute/sync", {"script": "mobile: " + command, "args": [args]})

    def front(self):
        app = self.mobile("activeAppInfo")
        if app.get("bundleId") != self.bundle:
            raise Stop("iPhone 前台应用不是抖音。")
        rect = self.request("/window/rect")
        if rect["x"] != 0 or rect["y"] != 0 or not 0 < rect["width"] < rect["height"]:
            raise Stop("当前仅支持全屏竖屏 iPhone。")
        return app["bundleId"], app.get("pid"), rect["width"], rect["height"]

    def grab(self):
        context = self.front()
        data = base64.b64decode(self.request("/screenshot"), validate=True)
        return Frame(png_image(data), context)

    def tap(self, frame, x, y):
        if self.front() != frame.context:
            raise Stop("iPhone 前台应用或显示尺寸已变化。")
        width, height = frame.context[2:]
        sx, sy = frame.image.width / width, frame.image.height / height
        if not math.isclose(sx, sy, rel_tol=0.005):
            raise Stop("截图与应用坐标系不一致。")
        self.mobile("tap", x=round(x / sx), y=round(y / sy))


def pick_regions(image, reference):
    import tkinter as tk
    from PIL import ImageTk
    root = tk.Tk()
    root.title("麦序校准 · 在截图上依次选择")
    scale = min(1, (root.winfo_screenwidth() - 100) / image.width,
                (root.winfo_screenheight() - 170) / image.height)
    thumb = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    photo = ImageTk.PhotoImage(thumb)
    steps = [
        ("room", "框选固定显示的店名或地址栏直播间号"),
        ("title", "框选目标商品的完整可见标题，须含「麦序」或「排队连麦选款」等区别文字"),
        ("price", "框选同一行的价格，包含货币符号、全部数字及末尾一位数字宽的留白"),
    ]
    if reference == "sold":
        steps += [("sold", "框选同一行缩略图上「已抢光」或其他明确售罄文字"),
                  ("button", "居中框选目标售罄按钮，包含文字与背景，四周留边"),
                  ("positive", "单击同屏另一行已确认可售、相同样式的亮色商品按钮正中心")]
    else:
        steps += [("face", "框选目标商品缩略图中部，可售时清晰、售罄时会被状态字覆盖的图案"),
                  ("button", "居中框选这张可售商品卡的入口按钮，须含完整文字与背景")]
    prompt = tk.StringVar()
    tk.Label(root, textvariable=prompt, anchor="w", padx=6, pady=7).pack(fill="x")
    canvas = tk.Canvas(root, width=photo.width(), height=photo.height(), highlightthickness=0)
    canvas.pack()
    canvas.create_image(0, 0, anchor="nw", image=photo)
    tk.Label(root, text="按提示在静态截图上选择。Esc 取消。只选择商品卡入口。").pack()
    regions = {}
    start = None

    def next_step(error=""):
        prompt.set(f"{len(regions) + 1}/{len(steps)}  {steps[len(regions)][1]}   {error}")

    def point(event):
        return (max(0, min(image.width - 1, round(event.x / scale))),
                max(0, min(image.height - 1, round(event.y / scale))))

    def down(event):
        nonlocal start
        start = point(event)

    def motion(event):
        if start is None or steps[len(regions)][0] == "positive":
            return
        canvas.delete("rubber")
        canvas.create_rectangle(start[0] * scale, start[1] * scale, event.x, event.y,
                                outline="#008953", width=2, tags="rubber")

    def up(event):
        if start is None:
            return
        canvas.delete("rubber")
        x, y = point(event)
        name = steps[len(regions)][0]
        if name == "positive":
            left, top, right, bottom = regions["button"]
            w, h = right - left, bottom - top
            left, top = x - w // 2, y - h // 2
            box = (left, top, left + w, top + h)
        else:
            box = (min(x, start[0]), min(y, start[1]), max(x, start[0]) + 1, max(y, start[1]) + 1)
        left, top, right, bottom = box
        if left < 0 or top < 0 or right > image.width or bottom > image.height or right-left < 9 or bottom-top < 7:
            next_step("范围太小或超出画面，请重选。")
            return
        if any(max(left, r[0]) < min(right, r[2]) and max(top, r[1]) < min(bottom, r[3]) for r in regions.values()):
            next_step("选择区域有重叠，请重选。")
            return
        regions[name] = box
        canvas.create_rectangle(*(v * scale for v in box), outline="#1671d2", width=2)
        if len(regions) == len(steps):
            root.destroy()
        else:
            next_step()

    canvas.bind("<Button-1>", down)
    canvas.bind("<B1-Motion>", motion)
    canvas.bind("<ButtonRelease-1>", up)
    root.bind("<Escape>", lambda _: root.destroy())
    next_step()
    root.mainloop()
    if len(regions) != len(steps):
        raise Stop("校准已取消。")
    return regions


def pixels(image):
    return np.asarray(image.convert("RGB"), dtype=np.int16)


def ink(template):
    background = np.median(template.reshape(-1, 3), axis=0)
    return np.abs(template - background).max(axis=2) > 28


def matches(live, box, template, mask, tolerance=2, strict=False):
    height, width = template.shape[:2]
    for dx, dy in [(0, 0)] + [(a, b) for a in range(-tolerance, tolerance + 1)
                                for b in range(-tolerance, tolerance + 1) if a or b]:
        x, y = box[0] + dx, box[1] + dy
        if x < 0 or y < 0 or x + width > live.shape[1] or y + height > live.shape[0]:
            continue
        delta = np.abs(live[y:y+height, x:x+width] - template).max(axis=2)
        if delta.mean() > 9 or delta[mask].mean() > 14 or (delta[mask] > 45).mean() > 0.06:
            continue
        if strict:
            # 长标题中只改一个字、或在金额后增加一位数字，全图平均差也可能很小。
            changed = np.pad(delta > 45, ((0, -height % 8), (0, -width % 8)))
            blocks = changed.reshape(changed.shape[0] // 8, 8, changed.shape[1] // 8, 8)
            if blocks.sum(axis=(1, 3)).max() > 5:
                continue
        return True
    return False


class Detector:
    def __init__(self, profile):
        self.size = tuple(profile["size"])
        self.boxes = profile["boxes"]
        self.reference = profile.get("reference", "sold")
        self.samples = {}
        for key, data in profile["samples"].items():
            template = pixels(png_image(base64.b64decode(data, validate=True)))
            mask = ink(template)
            if mask.sum() < 12:
                raise Stop("样本缺少可辨认的文字或图案，请重新校准。")
            self.samples[key] = template, mask
        self.box = self.boxes["button"]

    def classify(self, image):
        if image.size != self.size:
            return "layout"
        live = pixels(image)
        def present(sample, where=None):
            return matches(live, self.boxes[where or sample], *self.samples[sample],
                           strict=sample in {"room", "title", "price", "face"})
        if not present("room"):
            return "layout"
        if not present("title"):
            return "absent"
        if not present("price"):
            return "price"
        if self.reference == "open":
            return "ready" if present("face") and present("button") else "unknown"
        if present("sold"):
            return "sold"
        if present("positive", "button") and not present("button"):
            return "ready"
        return "unknown"

    def center(self):
        left, top, right, bottom = self.box
        return (left + right) // 2, (top + bottom) // 2


def make_profile(image, boxes, platform, reference="sold"):
    profile = {"version": 1, "platform": platform, "reference": reference, "size": image.size, "boxes": boxes,
               "samples": {key: image_data(image.crop(box)) for key, box in boxes.items()}}
    detector = Detector(profile)
    if reference == "sold" and matches(pixels(image), boxes["button"], *detector.samples["positive"]):
        raise Stop("售罄按钮与可售样本外观相同，这个布局无法可靠区分，请取消或重选。")
    if detector.classify(image) != ("sold" if reference == "sold" else "ready"):
        raise Stop("无法从校准画面确认商品状态。")
    return profile


def watch(source, detector, click, seconds, interval, report=print, trigger="restock"):
    deadline = time.monotonic() + seconds
    armed = False
    absent_frames = 0
    confirmations = 0
    previous = None
    messages = {"sold": "已认出目标商品和售罄标识，等待补货。",
                "absent": "当前还没有目标商品卡，等待它出现。",
                "baseline": "等待目标卡先离开当前区域，再观察它出现。",
                "price": "价格尚未匹配，等待完整的目标卡。",
                "unknown": "按钮状态不明确，继续观察。",
                "ready": "检测到目标按钮可售，正在复核。"}
    while time.monotonic() < deadline:
        frame = source.grab()
        state = detector.classify(frame.image)
        if state == "layout":
            raise Stop("店名或画面尺寸有变化，请重新检查页面。")
        if trigger == "appear":
            absent_frames = absent_frames + 1 if state == "absent" else 0
            armed |= absent_frames >= 2
            if not armed and state != "absent":
                state = "baseline"
        else:
            if state in {"absent", "price"}:
                raise Stop("目标标题或价格有变化，请重新检查列表。")
            if not armed and state != "sold":
                raise Stop("本轮启动需先在目标上看到明确的售罄状态。")
            armed |= state == "sold"
        confirmations = confirmations + 1 if state == "ready" else 0
        if state != previous:
            report(messages[state])
            previous = state
        if confirmations >= 2:
            last = source.grab()
            if last.context != frame.context or detector.classify(last.image) != "ready":
                raise Stop("临点击复核时画面发生变化。")
            if click:
                # 仅调用一次。即使设备应答超时，本进程也不会再次发送点击。
                source.tap(last, *detector.center())
                report("已发出一次商品入口点击，本轮结束。请自行查看下一页。")
                return "clicked"
            report("演练匹配成功，本轮结束。")
            return "rehearsed"
        time.sleep(interval)
    report("观察时间已到。")
    return "timeout"


@contextlib.contextmanager
def single_watcher():
    path = Path(tempfile.gettempdir()) / "douyin-queue-single-watcher.lock"
    with path.open("a+b") as lock:
        try:
            if sys.platform == "win32":
                import msvcrt
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise Stop("本机已有观察进程，请先结束旧的一轮。") from exc
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["calibrate", "watch"])
    parser.add_argument("device", choices=["windows", "android", "iphone"])
    parser.add_argument("--profile", required=True, type=Path, help="本机校准文件，如 pepper-windows.json")
    parser.add_argument("--serial", help="Android 的 adb 设备号，默认选择唯一 USB 设备")
    parser.add_argument("--session-url", default="", help="现有本机 iPhone Appium 会话地址")
    parser.add_argument("--click", action="store_true", help="匹配时真实打开一次，默认只演练")
    parser.add_argument("--trigger", choices=["restock", "appear"], help="原位补货或目标卡新出现。观察时默认沿用校准方式")
    parser.add_argument("--seconds", type=int, default=180, choices=range(1, 1801), metavar="1..1800")
    args = parser.parse_args()
    if args.device == "windows":
        source = Windows()
    elif args.device == "android":
        source = Android(args.serial)
    else:
        source = IPhone(args.session_url)
    if args.action == "calibrate" and args.profile.exists():
        raise Stop("此校准文件已存在，请选用一个新文件名。")
    if args.device == "windows":
        print("请在 5 秒内切到目标直播间，展开商品列表，并保持该窗口在前台。", flush=True)
        time.sleep(5)
    if args.action == "calibrate":
        frame = source.grab()
        reference = "open" if args.trigger == "appear" else "sold"
        boxes = pick_regions(frame.image, reference)
        profile = make_profile(frame.image, boxes, args.device, reference)
        with args.profile.open("x", encoding="utf-8") as out:
            json.dump(profile, out, ensure_ascii=False)
        print("校准文件已保存。", args.profile)
        return
    profile = json.loads(args.profile.read_text(encoding="utf-8"))
    if profile.get("version") != 1 or profile.get("platform") != args.device:
        raise Stop("校准文件的设备类型或版本不匹配。")
    trigger = args.trigger or ("appear" if profile.get("reference") == "open" else "restock")
    if trigger == "restock" and profile.get("reference") == "open":
        raise Stop("原位补货模式需要用该商品的售罄状态校准。")
    print(("单次点击" if args.click else "演练") + " · " + ("等新商品卡" if trigger == "appear" else "等原位补货"), flush=True)
    with single_watcher():
        watch(source, Detector(profile), args.click, args.seconds, 0.55, trigger=trigger)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("本轮已停止。")
    except (Stop, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        sys.exit(f"本轮已停止。{exc}")
