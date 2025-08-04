from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QPushButton, QMessageBox, QInputDialog
)
from PyQt5.QtCore import pyqtSignal


class ToolBar(QWidget):
    """Toolbar with action buttons for the note application."""
    add_note_clicked = pyqtSignal()
    save_note_clicked = pyqtSignal()
    delete_note_clicked = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.init_ui()

    def init_ui(self):
        """Initialize the UI components."""
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(5)

        # Buttons
        self.add_btn = QPushButton("Add Note")
        self.save_btn = QPushButton("Save Note")
        self.delete_btn = QPushButton("Delete Note")

        # Connect signals
        self.add_btn.clicked.connect(self.add_note_clicked.emit)
        self.save_btn.clicked.connect(self.save_note_clicked.emit)
        self.delete_btn.clicked.connect(self.confirm_delete)

        # Add buttons to layout
        layout.addWidget(self.add_btn)
        layout.addWidget(self.save_btn)
        layout.addWidget(self.delete_btn)
        layout.addStretch()  # Push buttons to the top

        self.setLayout(layout)

    def confirm_delete(self):
        """Show confirmation dialog before deleting a note."""
        reply = QMessageBox.question(
            self, 'Delete Note',
            'Are you sure you want to delete this note?',
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        if reply == QMessageBox.Yes:
            self.delete_note_clicked.emit()

    def get_note_title(self, current_title="") -> tuple[bool, str]:
        """Show dialog to get note title from user."""
        title, ok = QInputDialog.getText(
            self, 'Save Note', 'Enter note title:',
            text=current_title
        )
        return ok, title.strip() if ok else ""
