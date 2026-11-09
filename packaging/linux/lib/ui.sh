# shellcheck shell=bash
# Shared UI + logging helpers for FlowNote's Linux install.sh / uninstall.sh.
#
# One set of calls, three front-ends, picked by ui_init:
#   gui     zenity, else kdialog — with --gui, or when there's a desktop
#           session, no terminal (double-clicked from a file manager) and
#           the caller didn't pass the answers as flags.
#   tty     plain prompts in a terminal.
#   silent  no questions at all: --silent/-y, or nothing to ask on (no
#           terminal and no desktop, e.g. CI). Every question takes its
#           default answer.
#
# Everything the installer does is also appended to $FLOWNOTE_LOG
# (~/.cache/flownote-install.log), so a failed GUI install can be diagnosed.

FLOWNOTE_LOG="${FLOWNOTE_LOG:-${XDG_CACHE_HOME:-$HOME/.cache}/flownote-install.log}"
UI_MODE=silent
UI_TOOL=""
UI_TITLE="FlowNote"

_have() { command -v "$1" >/dev/null 2>&1; }

# ui_init <requested: auto|script|gui|tty|silent>
#   script = the caller was given its answers as flags (e.g. --appimage,
#   --remove-data): a terminal if there is one, otherwise silent — never pop
#   up dialogs at a script that runs without a terminal.
ui_init() {
  local want="${1:-auto}" desktop=0
  mkdir -p "$(dirname "$FLOWNOTE_LOG")" 2>/dev/null || true
  { echo; echo "=== $(date '+%F %T') $0 $* ==="; } >>"$FLOWNOTE_LOG" 2>/dev/null || FLOWNOTE_LOG=/dev/null

  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    if _have zenity; then UI_TOOL=zenity; desktop=1
    elif _have kdialog; then UI_TOOL=kdialog; desktop=1
    fi
  fi

  case "$want" in
    silent) UI_MODE=silent ;;
    gui)
      if [ "$desktop" -eq 1 ]; then UI_MODE=gui
      elif [ -t 0 ]; then UI_MODE=tty; log "no zenity/kdialog or no desktop session; using the terminal"
      else UI_MODE=silent
      fi
      ;;
    tty|script) if [ -t 0 ]; then UI_MODE=tty; else UI_MODE=silent; fi ;;
    *)
      if [ -t 0 ]; then UI_MODE=tty
      elif [ "$desktop" -eq 1 ]; then UI_MODE=gui
      else UI_MODE=silent
      fi
      ;;
  esac
  log "ui mode: $UI_MODE${UI_TOOL:+ ($UI_TOOL)}"
}

log() { printf '%s\n' "$*" >>"$FLOWNOTE_LOG" 2>/dev/null || true; }

# Status line: printed in tty/silent mode (that's the install transcript CI
# and terminal users see), logged always.
say() {
  log "==> $*"
  [ "$UI_MODE" = gui ] || printf '==> %s\n' "$*"
}

note() {
  log "note: $*"
  [ "$UI_MODE" = gui ] || printf 'note: %s\n' "$*"
}

# ui_info <text>: an information box (GUI) / plain text (terminal).
ui_info() {
  log "info: $1"
  case "$UI_MODE" in
    gui)
      if [ "$UI_TOOL" = zenity ]; then zenity --info --title="$UI_TITLE" --width=460 --text="$1" 2>/dev/null || true
      else kdialog --title "$UI_TITLE" --msgbox "$1" 2>/dev/null || true
      fi
      ;;
    *) printf '%s\n' "$1" ;;
  esac
}

# die <text>: show the error however the user can see it, then exit 1.
die() {
  log "error: $1"
  if [ "$UI_MODE" = gui ]; then
    local msg="$1"$'\n\n'"Details: $FLOWNOTE_LOG"
    if [ "$UI_TOOL" = zenity ]; then zenity --error --title="$UI_TITLE" --width=460 --text="$msg" 2>/dev/null || true
    else kdialog --title "$UI_TITLE" --error "$msg" 2>/dev/null || true
    fi
  fi
  printf 'error: %s\n' "$1" >&2
  exit 1
}

# ui_text_page <file> <ok-label>: show a long text (the release notice); the
# user continues or cancels (exit 0, nothing done). Skipped when silent.
ui_text_page() {
  local file="$1" ok="${2:-Continue}"
  [ -f "$file" ] || return 0
  case "$UI_MODE" in
    gui)
      if [ "$UI_TOOL" = zenity ]; then
        zenity --text-info --title="$UI_TITLE" --width=620 --height=460 --filename="$file" --ok-label="$ok" --cancel-label="Cancel" 2>/dev/null || ui_cancelled
      else
        kdialog --title "$UI_TITLE" --textbox "$file" 620 460 2>/dev/null || true
        kdialog --title "$UI_TITLE" --yesno "$ok?" 2>/dev/null || ui_cancelled
      fi
      ;;
    tty)
      echo; sed 's/^/  /' "$file"; echo
      ui_confirm "$ok?" yes || ui_cancelled
      ;;
  esac
}

ui_cancelled() { say "Cancelled — nothing was changed."; exit 0; }

# ui_confirm <question> <default: yes|no> — returns 0 for yes.
ui_confirm() {
  local q="$1" def="${2:-no}" answer
  case "$UI_MODE" in
    silent) [ "$def" = yes ]; return ;;
    gui)
      if [ "$UI_TOOL" = zenity ]; then zenity --question --title="$UI_TITLE" --width=460 --text="$q" 2>/dev/null
      else kdialog --title "$UI_TITLE" --yesno "$q" 2>/dev/null
      fi
      return
      ;;
  esac
  if [ "$def" = yes ]; then printf '%s [Y/n] ' "$q"; else printf '%s [y/N] ' "$q"; fi
  read -r answer || answer=""
  case "$answer" in
    [yY]|[yY][eE][sS]) return 0 ;;
    [nN]|[nN][oO]) return 1 ;;
    *) [ "$def" = yes ] ;;
  esac
}

# ui_choose <question> <default-key> <key> <label> [<key> <label>...]
# Prints the chosen key; exits (cancelled) if the user cancels.
ui_choose() {
  local q="$1" def="$2"; shift 2
  local keys=() labels=() i choice
  while [ $# -ge 2 ]; do keys+=("$1"); labels+=("$2"); shift 2; done

  case "$UI_MODE" in
    silent) echo "$def"; return ;;
    gui)
      local args=()
      if [ "$UI_TOOL" = zenity ]; then
        for i in "${!keys[@]}"; do
          if [ "${keys[$i]}" = "$def" ]; then args+=(TRUE); else args+=(FALSE); fi
          args+=("${keys[$i]}" "${labels[$i]}")
        done
        choice="$(zenity --list --radiolist --title="$UI_TITLE" --text="$q" --width=620 --height=300 \
          --column="" --column=key --column="Option" --hide-column=2 --print-column=2 "${args[@]}" 2>/dev/null)" || ui_cancelled
      else
        for i in "${!keys[@]}"; do
          args+=("${keys[$i]}" "${labels[$i]}")
          if [ "${keys[$i]}" = "$def" ]; then args+=(on); else args+=(off); fi
        done
        choice="$(kdialog --title "$UI_TITLE" --radiolist "$q" "${args[@]}" 2>/dev/null)" || ui_cancelled
      fi
      [ -n "$choice" ] || choice="$def"
      echo "$choice"
      return
      ;;
  esac

  # tty
  {
    echo "$q"
    for i in "${!keys[@]}"; do
      local mark=" "; [ "${keys[$i]}" = "$def" ] && mark="*"
      printf '  %d) %s %s\n' "$((i + 1))" "$mark" "${labels[$i]}"
    done
    printf 'Choose 1-%d [default: the one marked *, q to cancel]: ' "${#keys[@]}"
  } >&2
  read -r choice || choice=""
  case "$choice" in
    q|Q) ui_cancelled ;;
    "") echo "$def"; return ;;
  esac
  if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#keys[@]}" ]; then
    echo "${keys[$((choice - 1))]}"
  else
    echo "$def"
  fi
}

# ui_run <message> <command...>: runs a step, its output going to the log
# (and the terminal in tty/silent mode). In GUI mode a pulsing progress
# window is shown meanwhile. Returns the command's exit status.
ui_run() {
  local msg="$1"; shift
  say "$msg"
  log "\$ $*"
  if [ "$UI_MODE" != gui ]; then
    local rc=0
    "$@" 2>&1 | tee -a "$FLOWNOTE_LOG" || rc=${PIPESTATUS[0]}
    return "$rc"
  fi

  local rc=0 ppid_=""
  if [ "$UI_TOOL" = zenity ]; then
    (while :; do echo "# $msg"; sleep 1; done) | zenity --progress --pulsate --no-cancel --auto-close \
      --title="$UI_TITLE" --width=460 --text="$msg" 2>/dev/null &
    ppid_=$!
  else
    kdialog --title "$UI_TITLE" --passivepopup "$msg" 5 2>/dev/null &
  fi
  "$@" >>"$FLOWNOTE_LOG" 2>&1 || rc=$?
  if [ -n "$ppid_" ]; then
    # Kill the whole pipeline (the echo loop and zenity).
    pkill -P "$ppid_" 2>/dev/null || true
    kill "$ppid_" 2>/dev/null || true
    wait "$ppid_" 2>/dev/null || true
  fi
  return "$rc"
}

# as_root <command...>: root via sudo in a terminal, pkexec in the GUI
# (sudo can't ask for a password without a terminal), sudo -n otherwise.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; return; fi
  if [ "$UI_MODE" = gui ] && _have pkexec; then pkexec "$@"; return; fi
  if [ -t 0 ]; then sudo "$@"; else sudo -n "$@"; fi
}

# Closes any running FlowNote of this user (so files can be replaced or
# deleted safely). Waits up to 10 s, then forces it.
stop_flownote() {
  pgrep -u "$(id -u)" -x flownote >/dev/null 2>&1 || return 0
  say "Closing FlowNote"
  pkill -TERM -u "$(id -u)" -x flownote 2>/dev/null || true
  local _
  for _ in $(seq 1 20); do
    pgrep -u "$(id -u)" -x flownote >/dev/null 2>&1 || return 0
    sleep 0.5
  done
  pkill -KILL -u "$(id -u)" -x flownote 2>/dev/null || true
}

# Refreshes the desktop's app menu and icon caches. Best effort.
refresh_desktop_caches() {
  local data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
  _have update-desktop-database && update-desktop-database "$data_home/applications" >/dev/null 2>&1 || true
  _have gtk-update-icon-cache && [ -d "$data_home/icons/hicolor" ] && \
    gtk-update-icon-cache -q -t "$data_home/icons/hicolor" >/dev/null 2>&1 || true
  _have xdg-desktop-menu && xdg-desktop-menu forceupdate >/dev/null 2>&1 || true
}
