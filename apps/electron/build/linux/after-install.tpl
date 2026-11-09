#!/bin/bash
# FlowNote .deb post-install script (electron-builder.yml -> deb.afterInstall).
#
# Based on electron-builder 25's default linux/after-install.tpl, with one
# change: chrome-sandbox is ALWAYS made setuid root.
#
# The default only does that when `unshare --user true` fails, i.e. when the
# kernel has no user namespaces. On Ubuntu 24.04+ that test passes (unshare
# itself is allowed), but AppArmor's
# kernel.apparmor_restrict_unprivileged_userns denies user namespaces to
# unconfined apps like /opt/FlowNote/flownote. Chromium then falls back to
# the SUID helper, finds it without the setuid bit, and aborts at launch:
#   FATAL:setuid_sandbox_host.cc ... The SUID sandbox helper binary was
#   found, but is not configured correctly.
# A setuid-root helper is only used as a fallback when namespaces aren't
# available, so setting it everywhere is safe (it's what Chrome's own .deb
# does).
#
# ${...} placeholders are filled in by electron-builder at build time.

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

chown root:root '/opt/${sanitizedProductName}/chrome-sandbox' || true
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
