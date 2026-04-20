# Uninstalling Minerva Coach

## Windows

1. **Sign out first.** In Minerva Coach, click the ⓘ button in the top-right,
   scroll to the bottom of the About panel, and click **Sign out**. This
   deregisters your device with the Minerva backend so it stops receiving
   coaching data.

2. **Uninstall via Windows Settings.**
   - Open **Settings** → **Apps** → **Installed apps**
   - Find **Minerva Coach**, click the **⋯** menu, choose **Uninstall**
   - Follow the prompts

3. **Clean up leftover startup entry (optional).**
   Minerva registers itself to launch at login. The uninstaller may leave a
   stale entry behind:
   - Open **Task Manager** → **Startup apps** tab
   - If "Minerva Coach" is still listed, right-click and choose **Disable**
     (or **Delete** depending on your Windows version)

4. **Clean up the stored credential (optional).**
   Your signed-in session token is stored in Windows Credential Manager. If
   you signed out in step 1, this should already be empty. To verify:
   - Open **Control Panel** → **User Accounts** → **Credential Manager**
     → **Windows Credentials**
   - Look for an entry named `com.minervacoach.desktop`
   - If present, select it and click **Remove**

## macOS

macOS support is not yet available. This document will be updated when the
macOS installer ships.

## Linux

1. Sign out via the About panel (ⓘ button).
2. Remove the package:
   - Debian/Ubuntu: `sudo apt remove minerva-coach`
   - Or delete the AppImage if you installed via that method
3. Remove the autostart entry (optional):
   `~/.config/autostart/minerva-coach.desktop`
4. Remove the Secret Service keyring entry (optional):
   Open your desktop's keyring manager (e.g. GNOME Seahorse) and remove the
   `com.minervacoach.desktop` entry if it remains.

## Questions?

Email **matt@minervacoach.com** if you run into anything the above doesn't
cover.
