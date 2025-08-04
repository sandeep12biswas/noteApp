from app.repository.sqlite_repo import NoteRepository

class NoteController:
    def __init__(self):
        self.repo = NoteRepository()

    def get_all_notes(self):
        return self.repo.get_all()

    def save_note(self, title, content, tags=""):
        self.repo.insert(title, content, tags)

    def delete_note(self, note_id):
        self.repo.delete(note_id)
