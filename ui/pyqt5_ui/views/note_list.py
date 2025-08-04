from PyQt5.QtWidgets import (
    QListWidget, QListWidgetItem, QVBoxLayout, QWidget, QLabel
)
from PyQt5.QtCore import pyqtSignal, Qt
from typing import Dict, Any, Optional


class NoteList(QWidget):
    """A widget that displays a list of notes and allows selection."""
    note_selected = pyqtSignal(str)  # Emits the selected note ID

    def __init__(self, parent=None):
        super().__init__(parent)
        self.note_manager = None
        self.list_widget = QListWidget()  # Initialize here
        self.title_label = None  # Declare here for clarity
        self.init_ui()

    def init_ui(self):
        """Initialize the UI components."""
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        
        # Title label
        self.title_label = QLabel("Notes")
        layout.addWidget(self.title_label)
        
        # Configure list widget
        self.list_widget.itemClicked.connect(self._on_note_selected)
        layout.addWidget(self.list_widget)
        
        self.setLayout(layout)

    def set_note_manager(self, note_manager):
        """Set the note manager and connect signals."""
        self.note_manager = note_manager
        self.populate_list()

    def populate_list(self):
        """Populate the list with notes from the note manager."""
        if not self.note_manager:
            return
            
        self.list_widget.clear()
        notes = self.note_manager.get_all_notes()
        
        for note_id, note in notes.items():
            title = note.get('title', 'Untitled Note')
            item = QListWidgetItem(title)
            item.setData(Qt.UserRole, note_id)  # Store note ID in the item
            self.list_widget.addItem(item)
            
            # Select the first note by default
            if self.note_manager.current_note_id == note_id:
                self.list_widget.setCurrentItem(item)

    def add_note(self, note_id: str, title: str):
        """Add a new note to the list."""
        item = QListWidgetItem(title)
        item.setData(Qt.UserRole, note_id)
        self.list_widget.addItem(item)
        self.list_widget.setCurrentItem(item)

    def update_note_title(self, note_id: str, new_title: str):
        """Update the title of a note in the list."""
        for i in range(self.list_widget.count()):
            item = self.list_widget.item(i)
            if item.data(Qt.UserRole) == note_id:
                item.setText(new_title)
                break

    def remove_note(self, note_id: str):
        """Remove a note from the list."""
        for i in range(self.list_widget.count()):
            item = self.list_widget.item(i)
            if item.data(Qt.UserRole) == note_id:
                self.list_widget.takeItem(i)
                break

    def _on_note_selected(self, item):
        """Handle note selection."""
        note_id = item.data(Qt.UserRole)
        if note_id and self.note_manager:
            self.note_manager.current_note_id = note_id
            self.note_selected.emit(note_id)
