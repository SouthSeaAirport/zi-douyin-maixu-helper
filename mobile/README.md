# 手机和截图备用方案

此目录保留按屏幕图像识别的 Python 脚本。电脑上能打开「全部商品」时，首页的浏览器插件更简单。图像方案需要先在本设备校准，默认每 0.55 秒采样一次，另加读取设备的时间。

## 先准备

需要 Python 3.10 或以上、Tk、Pillow 和 NumPy。在本目录打开终端，Windows 可执行 `py -3 -m pip install "Pillow>=9.1" numpy`。macOS 使用 `python3`。把目标房间保持在前台，展开商品列表，确保店名或房间号、目标标题、价格、售罄文字和可售按钮样式都能看见。

## Windows 图像模式

```powershell
py -3 麦序单次点击.py calibrate windows --profile desktop.json
py -3 麦序单次点击.py watch windows --profile desktop.json
py -3 麦序单次点击.py watch windows --profile desktop.json --click
```

第一条会留 5 秒切回直播间。按屏幕提示选定店名、标题、价格、售罄文字、售罄按钮及同样式的可售按钮。第二条演练，第三条在下一轮符合条件时实点一次。新弹卡模式可在校准时加 `--trigger appear`，按提示选以前见过的可售目标卡。

## 安卓手机

安装 Android SDK Platform-Tools，手机启用 USB 调试并授权这台电脑。用 `adb devices` 核对连接。如果有多台设备，在两条命令后都加 `--serial 设备号`。[Android 官方 ADB 文档](https://developer.android.com/tools/adb)

```powershell
py -3 麦序单次点击.py calibrate android --profile android.json
py -3 麦序单次点击.py watch android --profile android.json --click
```

## iPhone

在本机 Appium 已有一个可以控制本人 iPhone 的 XCUITest 会话后，把下面的 `SESSION_ID` 改成实际 ID，保持官方抖音 App 在竖屏前台。常用环境为 Mac、Xcode 和已签名的 WebDriverAgent。Windows 主机的支持条件见官方指南。[真机条件](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/system-requirements/) · [Windows 主机](https://appium.github.io/appium-xcuitest-driver/latest/guides/non-macos-hosts/)

```shell
python3 麦序单次点击.py calibrate iphone --profile iphone.json --session-url http://127.0.0.1:4723/session/SESSION_ID
python3 麦序单次点击.py watch iphone --profile iphone.json --session-url http://127.0.0.1:4723/session/SESSION_ID --click
```

手机模式去掉 `--click` 就是演练。默认观察 180 秒，可加 `--seconds 600`。Ctrl+C 停止。校准文件包含本地选取的小块画面，可自己保存，勿提交到 Git。手机端已验证协议参数及坐标换算，仍待安卓和 iPhone 真机端到端验证。
