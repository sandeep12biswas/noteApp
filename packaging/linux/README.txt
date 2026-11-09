FlowNote for Linux
==================

Built for 64-bit PCs (x86_64). Step-by-step instructions with pictures:
docs/FlowNote-Installation-Guide.pdf. Using FlowNote: docs/FlowNote-User-Guide.pdf
and docs/FlowNote-Feature-Guide.pdf (each also as an editable Word .docx).

INSTALL — the easy way
  Double-click FlowNote-<version>-linux-x86_64.run (or run it in a terminal)
  and follow the steps. You choose between:
    * For everyone on this computer — a system package (.deb, Debian/Ubuntu;
      asks for your password).
    * Just for me — no password needed, works on any distro (AppImage).
  If double-clicking opens it as text, right-click it → Properties →
  Permissions → "Allow executing file as program", or run:
      chmod +x FlowNote-*.run && ./FlowNote-*.run

INSTALL — from this folder (terminal)
  ./install.sh                 Guided install (asks the questions above).
  ./install.sh --appimage      Just for me, no password.
  ./install.sh --deb           For everyone (system package).
  ./install.sh --silent        No questions; the default for this system.
  ./install.sh --help          All options.

  Then open FlowNote from your app menu, or run: flownote

  Or install by hand:
    sudo apt install ./FlowNote-<version>-amd64.deb
    or: chmod +x FlowNote-<version>-x86_64.AppImage and run it.

UNINSTALL
  ./uninstall.sh                 Asks before removing, and whether to delete
                                 your notes too.
  ./uninstall.sh --keep-data     Removes FlowNote, keeps your notes.
  ./uninstall.sh --remove-data   Removes FlowNote and your notes.
  ~/.local/opt/flownote/uninstall.sh   Same, without this download (for the
                                       "just for me" install).
  (Or: sudo apt remove flownote, for the system package.)

WHERE YOUR DATA LIVES
  ~/.config/@flownote/electron/flownote.sqlite3   (notes)
  ~/.config/@flownote/electron/attachments/       (attached files)
  ~/.config/@flownote/electron/backups/           (copies made before syncing)
  Uninstalling keeps these unless you choose to delete them, so a reinstall
  picks your notes back up.

CHECKING THE DOWNLOAD
  sha256sum -c SHA256SUMS

TROUBLESHOOTING
  - Install log: ~/.cache/flownote-install.log
  - The AppImage needs FUSE 2 to start quickly. Without it, install.sh sets
    FlowNote up to unpack itself on each start instead. For faster starts:
    sudo apt install libfuse2t64   (Ubuntu 24.04 and later; libfuse2 before)
  - Graphical installer dialogs need zenity or kdialog; without them the
    installer asks its questions in a terminal instead.
  - These packages are not signed.
