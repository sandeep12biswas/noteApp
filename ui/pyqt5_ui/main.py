import sys
from PyQt5.QtWidgets import QApplication
from PyQt5.QtGui import QIcon
from ui.pyqt5_ui.views.main_window import NoteApp

def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Note Taking App")
    app.setWindowIcon(QIcon(":/icons/app_icon.png"))  # Make sure to add an icon file
    
    # Set application style
    app.setStyle('Fusion')
    
    window = NoteApp()
    window.show()
    
    sys.exit(app.exec_())

if __name__ == "__main__":
    main()