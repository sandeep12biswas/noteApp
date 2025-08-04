from config.settings import UI_FRAMEWORK

def launch_ui():
    if UI_FRAMEWORK == "pyqt5":
        from ui.pyqt5_ui.main import run
    elif UI_FRAMEWORK == "kivy":
        from ui.kivy_ui.main import run
    else:
        raise ValueError("Invalid UI framework")
    run()
