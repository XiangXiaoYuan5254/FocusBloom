# dmgbuild 的配置：官网下载的 Mac 安装包 FocusBloom-macOS.dmg，由 Scripts/release_mac.sh 调用。
# 打开后是一个 540×380 的窗口，和页间的安装包一样：左边专注芽，右边「应用程序」，
# 中间的虚线箭头（Scripts/dmg/background.swift 画的）提示拖过去，上方是安装说明。
#
# release_mac.sh 用 -D 传进来：app（已公证的专注芽.app）、readme、background、icon（卷图标）。
import os.path

app = defines["app"]
readme = defines["readme"]

format = "UDZO"
files = [app, readme]
symlinks = {"Applications": "/Applications"}
icon = defines["icon"]
background = defines["background"]

window_rect = ((400, 530), (540, 380))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 88
text_size = 12
icon_locations = {
    os.path.basename(app): (130, 220),
    "Applications": (410, 220),
    os.path.basename(readme): (270, 75),
}
