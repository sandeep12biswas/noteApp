from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QSplitter, QFrame, QLabel
)
from PyQt5.QtCore import Qt

from ui.pyqt5_ui.models.note import NoteManager
# Import our custom components
from ui.pyqt5_ui.views.editor_area import RichTextEditor
from ui.pyqt5_ui.views.note_list import NoteList
from ui.pyqt5_ui.views.toolbar import ToolBar


class NoteApp(QWidget):
    """Main application window for the Note Taking App."""
    
    def __init__(self):
        super().__init__()
        
        # Initialize the note manager
        self.note_manager = NoteManager()
        
        # UI Components
        self.note_editor = None
        self.note_list = None
        self.toolbar = None
        
        # Initialize the UI
        self.setWindowTitle("Note Taking App")
        self.resize(1000, 700)
        self.init_ui()
        
        # Set the note manager for the note list
        self.note_list.set_note_manager(self.note_manager)
        
        # Connect signals
        self._connect_signals()
        
        # Load the first note if available
        if self.note_manager.notes:
            # Select the first note in the list
            if self.note_list.list_widget.count() > 0:
                self.note_list.list_widget.setCurrentRow(0)
                # Manually trigger the note selection
                first_item = self.note_list.list_widget.item(0)
                if first_item:
                    self._load_note_content(first_item.data(Qt.UserRole))

    def init_ui(self):
        """Initialize the main window UI."""
        # Create the main splitter that will hold all sections
        main_splitter = QSplitter()
        
        # Left section - Notes list and toolbar
        left_widget = QFrame()
        left_widget.setFrameShape(QFrame.StyledPanel)
        left_layout = QVBoxLayout()
        left_layout.setContentsMargins(5, 5, 5, 5)
        left_layout.setSpacing(5)
        
        # Create and add the note list
        self.note_list = NoteList()
        self.note_list.set_note_manager(self.note_manager)
        
        # Create and add the toolbar
        self.toolbar = ToolBar()
        
        left_layout.addWidget(self.note_list)
        left_layout.addWidget(self.toolbar)
        left_widget.setLayout(left_layout)
        
        # Middle section - Preview (placeholder for future use)
        middle_widget = QFrame()
        middle_widget.setFrameShape(QFrame.StyledPanel)
        middle_layout = QVBoxLayout()
        middle_layout.addWidget(QLabel("Preview (Coming Soon)"))
        middle_widget.setLayout(middle_layout)
        middle_widget.setMinimumWidth(150)
        
        # Right section - Editor
        right_widget = QFrame()
        right_widget.setFrameShape(QFrame.StyledPanel)
        right_layout = QVBoxLayout()
        right_layout.setContentsMargins(0, 0, 0, 0)
        
        self.note_editor = RichTextEditor()
        right_layout.addWidget(QLabel("Note Content"))
        right_layout.addWidget(self.note_editor)
        right_widget.setLayout(right_layout)
        
        # Add all sections to the main splitter
        main_splitter.addWidget(left_widget)
        main_splitter.addWidget(middle_widget)
        main_splitter.addWidget(right_widget)
        
        # Set initial sizes (left: 1, middle: 1, right: 2 ratio)
        total_width = self.width()
        left_size = int(total_width * 0.25)
        middle_size = int(total_width * 0.25)
        right_size = total_width - left_size - middle_size
        
        main_splitter.setSizes([left_size, middle_size, right_size])
        
        # Configure the splitter
        main_splitter.setHandleWidth(8)
        main_splitter.setChildrenCollapsible(False)
        
        # Set the main layout
        main_layout = QHBoxLayout()
        main_layout.addWidget(main_splitter)
        main_layout.setContentsMargins(2, 2, 2, 2)
        self.setLayout(main_layout)
    
    def _connect_signals(self):
        """Connect all the signals and slots."""
        # Toolbar signals
        self.toolbar.add_note_clicked.connect(self._add_note)
        self.toolbar.save_note_clicked.connect(self._save_note)
        self.toolbar.delete_note_clicked.connect(self._delete_note)
        
        # Note list signals
        self.note_list.note_selected.connect(self._load_note_content)
        
        # Connect the item selection signal
        self.note_list.list_widget.itemClicked.connect(self._on_note_clicked)
    
    def _on_note_clicked(self, item):
        """Handle note click events."""
        note_id = item.data(Qt.UserRole)
        if note_id:
            self._load_note_content(note_id)
        
    
    def _add_note(self):
        """Handle adding a new note."""
        # Create a new note
        note_id = self.note_manager.create_note()
        
        # Add to the list
        self.note_list.add_note(note_id, "Untitled Note (unsaved)")
        
        # Clear the editor
        self.note_editor.clear()
    
    def _save_note(self):
        """Handle saving the current note."""
        if not self.note_manager.current_note_id:
            return
            
        # Get the current note
        note = self.note_manager.get_current_note()
        if not note:
            return
            
        # Check if we need to prompt for a name
        if not note.get('is_named', False):
            ok, new_title = self.toolbar.get_note_title(note.get('title', ''))
            if not ok or not new_title:
                return  # User cancelled
                
            # Update the note
            self.note_manager.update_note(
                self.note_manager.current_note_id,
                title=new_title,
                content=self.note_editor.toHtml(),
                is_named=True
            )
            
            # Update the list item
            self.note_list.update_note_title(self.note_manager.current_note_id, new_title)
        else:
            # Just update the content
            self.note_manager.update_note(
                self.note_manager.current_note_id,
                content=self.note_editor.toHtml()
            )
        
        # Save to disk
        try:
            self.note_manager.save_notes()
        except Exception as e:
            from PyQt5.QtWidgets import QMessageBox
            QMessageBox.warning(self, "Error", f"Failed to save notes: {str(e)}")
    
    def _delete_note(self):
        """Handle deleting the current note."""
        if not self.note_manager.current_note_id:
            return
            
        # Delete the note
        self.note_manager.delete_note(self.note_manager.current_note_id)
        
        # Remove from the list
        self.note_list.remove_note(self.note_manager.current_note_id)
        
        # Clear the editor
        self.note_editor.clear()
        
        # Save changes
        try:
            self.note_manager.save_notes()
        except Exception as e:
            from PyQt5.QtWidgets import QMessageBox
            QMessageBox.warning(self, "Error", f"Failed to save notes: {str(e)}")
    
    def _load_note_content(self, note_id):
        """Load the content of the selected note into the editor."""
        print(f"Loading note with ID: {note_id}")  # Debug log
        if not note_id:
            print("No note ID provided")  # Debug log
            return
            
        # Save any changes to the previous note
        if self.note_manager.current_note_id:
            print(f"Saving changes to previous note: {self.note_manager.current_note_id}")  # Debug log
            current_note = self.note_manager.get_current_note()
            if current_note:
                print(f"Previous note content length: {len(current_note.get('content', ''))} chars")  # Debug log
                self.note_manager.update_note(
                    self.note_manager.current_note_id,
                    content=self.note_editor.toHtml()
                )
        
        # Update the current note ID
        self.note_manager.current_note_id = note_id
        print(f"Updated current_note_id to: {note_id}")  # Debug log
        
        # Load the new note
        note = self.note_manager.get_note(note_id)
        if note:
            content = note.get('content', '')
            print(f"Loading note content, length: {len(content)} chars")  # Debug log
            self.note_editor.setHtml(content)
            print("Content loaded into editor")  # Debug log
        else:
            print(f"No note found with ID: {note_id}")  # Debug log
            self.note_editor.clear()
    
    def closeEvent(self, event):
        """Handle the window close event."""
        # Save any changes to the current note before closing
        if self.note_manager.current_note_id:
            note = self.note_manager.get_current_note()
            if note:
                self.note_manager.update_note(
                    self.note_manager.current_note_id,
                    content=self.note_editor.toHtml()
                )
        
        # Save all notes to disk
        try:
            self.note_manager.save_notes()
        except Exception as e:
            from PyQt5.QtWidgets import QMessageBox
            QMessageBox.warning(self, "Error", f"Failed to save notes: {str(e)}")
        
        event.accept()