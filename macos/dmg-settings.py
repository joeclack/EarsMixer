# dmgbuild settings for the macOS disk image. tools/build-macos.cjs passes:
#   -D app=<EarsMixer.app>  -D background=<background.tiff>  -D size=<e.g. 400M>
# Icon positions must match the arrow in macos/dmg-background.swift.
import os

app = defines["app"]  # noqa: F821 (provided by dmgbuild)
app_name = os.path.basename(app)

format = "UDZO"
filesystem = "HFS+"
size = defines.get("size")  # noqa: F821
files = [app]
symlinks = {"Applications": "/Applications"}
icon = os.path.join(app, "Contents", "Resources", "AppIcon.icns")

background = defines["background"]  # noqa: F821
window_rect = ((200, 120), (600, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 128
text_size = 13
arrange_by = None
icon_locations = {app_name: (160, 190), "Applications": (440, 190)}
