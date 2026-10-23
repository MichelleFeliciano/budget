# Checking Budget on real phones

These are the things the automated tests cannot prove, because they need a real phone, a real home screen and the
real sync server. It takes about ten minutes. Use made-up bills while you try this, and do not paste your passphrase
anywhere but the app's own Passphrase box.

This list has been worked through on the owner's phone (install, offline use and a live sync all passed); run it again after big changes. Mark each step done as you go. If a step fails, write down what you saw (and which phone and browser) and tell Claude.

## On one phone

1. **Install it.** Open https://michellefeliciano.github.io/budget/ in the phone's browser.
   - iPhone (Safari): Share, then Add to Home Screen.
   - Android (Chrome): the menu, then Install app (or Add to Home screen).
2. **Open it from the new icon.** It should open full screen with no browser bar, and the icon should be the new
   vine-and-sage one. The Menu should say the current version.
3. **Use it offline.** Close the app, turn on airplane mode, open it from the icon again. It should open and show
   your data. Add a made-up bill; it should save. Turn airplane mode off.
4. **Add a repeating bill with an old date** (for example a monthly bill first due three months ago). The "I'm caught up"
   box should appear. Add it ticked, and check that nothing earlier shows as overdue.
5. **Mark paid, then Undo.** Tap Mark paid on a bill. A bar with Undo should appear at the bottom. Tap Undo.
6. **Try the + button, the Earlier and Later buttons, a tap on a day and Add a bill on this day.**
7. **Text size.** In the Menu, tap Text size until it is Largest, look around for anything cut off or overlapping, then
   put it back.
8. **Lock.** Turn on App lock, switch to another app for a few minutes, come back. It should ask for the PIN. Turn the
   lock off again if you do not want it.
9. **Share backup.** In the Menu, tap Share backup (if it is there) and send the file to Files or email. Open it and
   check it is readable text. Delete it afterwards, since it holds your bills.
10. **Calendar reminders.** In the Menu, tap Calendar reminders. Open the downloaded file and add it to your calendar.
    Check that your bills appear on the right days and repeat as they should.

## Sync between two devices

1. On phone A, set up sync with your passphrase and tap Sync (or Sync now). The first sync after the server has been
   asleep can take a minute or more; the status counts the seconds.
2. On phone B (or a computer), open the app, set up sync with the same passphrase. Your bills should appear.
3. Mark a bill paid on A, sync A, then sync B. B should show it paid.
4. Delete a made-up bill on B, sync B, then sync A. It should be gone on A and stay gone.
5. Leave the app alone for 20 minutes (the free server sleeps and forgets its copy), then tap Sync. It should say the
   server had been reset and everything was sent again, and nothing on either phone should be lost.

## Getting a new version

1. When a new version has been published, open the app and wait a few seconds. A bar saying "A new version of Budget is
   ready" should appear at the top. Tap Update now. The Menu's version number should go up.

When all of this works, say so and the "Not yet verified" note in `CLAUDE.md` can be removed.
