FlowNote for Linux — preview build
==================================

Built for 64-bit PCs (x86_64). Open a terminal in this folder.

INSTALL — either:
  ./install.sh              Debian/Ubuntu: installs the .deb (asks for your
                            password). Other distros: installs the AppImage
                            just for you, no password needed.
  ./install.sh --appimage   The AppImage for your user only, on any distro.

  Then open FlowNote from your app menu, or run: flownote

  Or install by hand:
    sudo apt install ./FlowNote-<version>-amd64.deb
    or: chmod +x FlowNote-<version>-x86_64.AppImage and run it.

UNINSTALL
  ./uninstall.sh                 Removes FlowNote and asks whether to delete
                                 your notes too.
  ./uninstall.sh --keep-data     Removes FlowNote, keeps your notes.
  ./uninstall.sh --remove-data   Removes FlowNote and your notes.
  (Or: sudo apt remove flownote, for the .deb.)

WHERE YOUR DATA LIVES
  ~/.config/@flownote/electron/flownote.sqlite3   (notes)
  ~/.config/@flownote/electron/attachments/       (attached files)
  ~/.config/@flownote/electron/backups/           (copies made before syncing)
  Uninstalling keeps these unless you choose to delete them, so a reinstall
  picks your notes back up.

TROUBLESHOOTING
  - The AppImage needs FUSE 2 to start quickly. Without it, install.sh sets
    FlowNote up to unpack itself on each start instead. For faster starts:
    sudo apt install libfuse2t64   (Ubuntu 24.04 and later; libfuse2 before)
  - These packages are not signed.
