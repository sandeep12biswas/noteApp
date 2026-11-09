# Cloud sync: registering FlowNote with OneDrive and Google Drive

FlowNote syncs through the user's own OneDrive or Google Drive. To sign users in, each build needs an app registration with Microsoft and with Google. These are free and done once by whoever publishes the build. They aren't secret in the usual sense: desktop apps ship them, and PKCE protects each sign-in.

| Setting | Where it comes from |
|---|---|
| `FLOWNOTE_ONEDRIVE_CLIENT_ID` | Microsoft Entra app registration → *Application (client) ID* |
| `FLOWNOTE_GOOGLE_CLIENT_ID` | Google Cloud → OAuth client (Desktop app) → *Client ID* |
| `FLOWNOTE_GOOGLE_CLIENT_SECRET` | the same OAuth client → *Client secret* |

Set these as environment variables **when building** (`cargo build --release -p flownote-electron`, `pnpm --filter @flownote/tauri tauri build`) and they are compiled in. Set **when running**, they override the built-in values, which is useful during development. The installer workflows read them from repository secrets of the same names (*Settings → Secrets and variables → Actions*).

A build without them works normally, except that the OneDrive and Google Drive options report that the build isn't registered. Syncing to a local folder needs no registration.

## OneDrive (Microsoft Entra ID)

1. Sign in at <https://entra.microsoft.com> → *Applications → App registrations → New registration*.
2. Fill in the registration:
   - **Name:** FlowNote.
   - **Supported account types:** *Accounts in any organizational directory and personal Microsoft accounts*.
   - **Redirect URI:** platform *Public client/native (mobile & desktop)*, value `http://localhost`. FlowNote listens on a random port; Microsoft accepts any port for `http://localhost`.
3. *Authentication → Advanced settings → Allow public client flows*: **Yes**.
4. *API permissions → Add a permission → Microsoft Graph → Delegated*: add `Files.ReadWrite.AppFolder`, `User.Read` and `offline_access`.
5. Copy the *Application (client) ID* from *Overview* into `FLOWNOTE_ONEDRIVE_CLIENT_ID`.

FlowNote sees only its own app folder: **Apps/FlowNote** in the user's OneDrive.

## Google Drive (Google Cloud)

1. At <https://console.cloud.google.com>, create a project, then *APIs & Services → Library → Google Drive API → Enable*.
2. Set up *OAuth consent screen*:
   - User type **External**; fill in the app name and contact address.
   - Under *Data access*, add the scope `https://www.googleapis.com/auth/drive.file`.
   - While the app is in **Testing**, only the listed test users can sign in, and their sign-ins expire after 7 days. FlowNote then asks them to sign in again. **Publish** the app for long-lived sign-ins. `drive.file` isn't a sensitive scope, so publishing doesn't need Google's full verification.
3. *Credentials → Create credentials → OAuth client ID → Application type: Desktop app*. Desktop clients accept a loopback redirect (`http://127.0.0.1:<port>`) without registering one.
4. Copy the *Client ID* and *Client secret* into `FLOWNOTE_GOOGLE_CLIENT_ID` and `FLOWNOTE_GOOGLE_CLIENT_SECRET`.

FlowNote sees only the files it created, kept in a **FlowNote** folder at the top of the user's My Drive.

## What's stored in the cloud

Everything except `vault.json` is encrypted on the device with the user's sync passphrase before upload (`flownote_core::crypto`). The provider stores ciphertext and can't read notes. A lost passphrase can't be recovered: the cloud copy is then unreadable, though each device still has its notes.

Sign-in tokens stay in the local database (`sync_settings.oauth_tokens`) and are never sent to the app's UI. Disconnecting removes them.
