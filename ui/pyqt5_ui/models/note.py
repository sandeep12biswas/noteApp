import os
import json
from datetime import datetime
from typing import Dict, Any, Optional

class NoteManager:
    def __init__(self, data_dir: str = '~/.noteapp'):
        """Initialize the note manager with a data directory."""
        self.data_dir = os.path.expanduser(data_dir)
        self.notes_file = os.path.join(self.data_dir, 'notes.json')
        self.notes: Dict[str, Dict[str, Any]] = {}
        self.current_note_id: Optional[str] = None
        self._ensure_data_dir()
        self.load_notes()

    def _ensure_data_dir(self) -> None:
        """Ensure the data directory exists."""
        os.makedirs(self.data_dir, exist_ok=True)

    def load_notes(self) -> None:
        """Load notes from the JSON file."""
        try:
            if os.path.exists(self.notes_file):
                with open(self.notes_file, 'r', encoding='utf-8') as f:
                    self.notes = json.load(f)
                # Sort notes by updated_at in descending order (newest first)
                self.notes = dict(sorted(
                    self.notes.items(),
                    key=lambda x: x[1].get('updated_at', ''),
                    reverse=True
                ))
        except json.JSONDecodeError:
            # If file is empty or corrupt, initialize empty notes
            self.notes = {}
            if os.path.exists(self.notes_file):
                os.remove(self.notes_file)
        except Exception as e:
            self.notes = {}
            raise Exception(f"Failed to load notes: {str(e)}")

    def save_notes(self) -> bool:
        """Save notes to the JSON file."""
        try:
            # Prepare notes data for saving
            notes_to_save = {}
            for note_id, note in self.notes.items():
                note_data = note.copy()
                # Remove any temporary data that shouldn't be saved
                note_data.pop('is_named', None)
                notes_to_save[note_id] = note_data

            with open(self.notes_file, 'w', encoding='utf-8') as f:
                json.dump(notes_to_save, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            raise Exception(f"Failed to save notes: {str(e)}")

    def create_note(self, title: str = "Untitled Note") -> str:
        """Create a new note and return its ID."""
        note_id = datetime.now().strftime("%Y%m%d%H%M%S")
        self.notes[note_id] = {
            'title': title,
            'content': '',
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'is_named': False
        }
        self.current_note_id = note_id
        return note_id

    def update_note(self, note_id: str, title: Optional[str] = None, 
                   content: Optional[str] = None, is_named: Optional[bool] = None) -> None:
        """Update a note's properties."""
        if note_id not in self.notes:
            raise ValueError(f"Note with ID {note_id} not found")
        
        note = self.notes[note_id]
        if title is not None:
            note['title'] = title
        if content is not None:
            note['content'] = content
        if is_named is not None:
            note['is_named'] = is_named
            
        note['updated_at'] = datetime.now().isoformat()
        self.current_note_id = note_id

    def delete_note(self, note_id: str) -> None:
        """Delete a note by its ID."""
        if note_id in self.notes:
            del self.notes[note_id]
            if self.current_note_id == note_id:
                self.current_note_id = None

    def get_note(self, note_id: str) -> Optional[Dict[str, Any]]:
        """Get a note by its ID."""
        return self.notes.get(note_id)

    def get_all_notes(self) -> Dict[str, Dict[str, Any]]:
        """Get all notes."""
        return self.notes

    def get_current_note(self) -> Optional[Dict[str, Any]]:
        """Get the currently selected note."""
        if self.current_note_id:
            return self.get_note(self.current_note_id)
        return None
