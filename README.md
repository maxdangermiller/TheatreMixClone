# Presonus Theatre Mix
**Created By:** Max Miller

This repository is a Node.js based implementation of [TheatreMix](https://www.theatremix.com) created by James Holt. It takes in a TheatreMix file (.tmix) and allows using some features that TheatreMix supports on other consoles.

This software was developed due to the lack of support for PreSonus StudioLive consoles in TheatreMix. It is not intended to infringed on any intellectual property of Mixing Technology Pty Ltd, and still requires using the original TheatreMix app to program, this app simply translates the TheatreMix file into something the StudioLive consoles respond to.

The app uses Electron.js alongside React.js. The presonus interface is based off of @featherbear's [presonus-studiolive-api](https://github.com/featherbear/presonus-studiolive-api)

## Usage
First Install Homebrew (You have already done this)

You **CAN** copy and paste these commands

### INSTALL
### INSTALL dmg
Download the newest version from the [release tab](https://github.com/maxdangermiller/PresonusTheatreMix/releases), then open the .dmg file

From there, type in the following command but **DO NOT PRESS ENTER**. Once you have typed this, then drag the installed application from the Applications/ folder into the terminal, THEN press enter.
```bash
xattr -rd com.apple.quarantine 
```


### INSTALL Source
Starting in a new terminal, run the following commands to setup on device compilation:

```bash
brew install git
brew install node@22
cd Desktop/
mkdir PresonusTheatreMix
cd PresonusTheatreMix/
git clone https://github.com/maxdangermiller/PresonusTheatreMix.git
cd PresonusTheatreMix/
npm install
npm start
```

### UPDATE
Starting in a **new terminal**, run the following commands to update the code:

```bash
cd Desktop/PresonusTheatreMix/PresonusTheatreMix/
rm -rf node_modules package-lock.json
npm cache clean --force
git pull origin
npm install 
npm start
```

## PATCHES
**Run this to save changes made to the api**
```bash
npx patch-package @featherbear/presonus-studiolive-api
```

## Console Go / Back buttons
Two of the console's **mute group** buttons can be used as Go and Back, like TheatreMix's "Mute Group Buttons".

**Setup**
1. Open the show and connect to the console (**File → Console Setup**, ⌘K).
2. In **Mute Group Buttons (StudioLive)**, pick **Go** for one mute group and **Back** for another. Each box shows the console's name for the group and whether it's **Empty**. Use empty groups: a group with channels in it shows a ⚠ warning, because pressing it will also mute those channels.
3. Press the buttons on the console to test them: the box lights up green when it fires Go/Back (blue if the button isn't mapped).
4. Click **OK** (or **Apply**), then save the show (⌘S). The buttons are stored in the `.tmixp`, so merging an updated `.tmix` won't change them.

If a show has no StudioLive buttons set yet, it uses the ones from TheatreMix (**Console Setup → Mute Group Buttons**), e.g. the Lion King show's mute group 6 = Go, 5 = Back. Once you set them here, this app's setting is used instead.

**If the buttons don't work**
1. **Help → Console Buttons...** shows what the show has mapped, whether those mute groups are empty, and how many presses have been seen.
2. Turn on **Help → Log All Console Messages**, press the buttons, then turn it off again.
3. **Help → Show Debug Log** opens the log file (`~/Library/Logs/Presonus TheatreMix/debug.log`). Lines tagged `[BUTTONS]` show every mute group change, and `[CONSOLE]` shows every message from the console while logging all messages. Send this file in for help.


## Testing with the console simulator
`sim/studiolive_sim.py` pretends to be the StudioLive 32. It's accurate enough that **Universal Control** finds it, opens the full mixer, and shows changes live, so the app can be tested without the real console.

1. Give your Mac the console's address on loopback (once per boot): `sudo ifconfig lo0 alias 169.254.4.171`
2. Start the simulator with the console's real state:
   ```bash
   python3 sim/studiolive_sim.py --bind-ip 169.254.4.171 --broadcast-addr 127.0.0.1 --state-file state.json --meter-hz 20
   ```
   `--broadcast-addr 127.0.0.1` keeps its announcements on this Mac (without it they go out on your network). `--meter-hz 20` sends meter data like the real console, which channel monitoring needs.
3. Open Universal Control and/or this app. Both find "StudioLive 32 Hayden" through discovery. Start the simulator **before** Universal Control; it only looks for consoles when it opens.
4. Type commands into the simulator to act like the console, e.g. `set mutegroup/mutegroup6 1` (press the Go button), `set line/ch1/mute 1`, `name line/ch2/username Nala`, `dca` (show DCAs), `signal 3 -20` / `signal 3 off` / `signal all off` (a mic with / without signal), `kick` (drop connections, like a network blip), `help`.

## Channel monitoring
Like TheatreMix, the show's channels are coloured on the console from the meters: **red** when nearly clipping (−3 dBFS or louder; faulty cable or connector), held for 10 seconds after the last peak so it can be checked; **blue** after 3 seconds below −60 dBFS (mic off, flat battery, out of range); **white** when there's signal; **yellow** when there's signal and the channel is in the current cue's DCAs. Settings are at the top of `src/main/channelMonitor.js`. Lines tagged `[METERS]` in the debug log show every colour change and the console's meter layout.

## DEBUGGING
1) First locate the Presonus TheatreMix app in your applications folder
2) Right click and press show package contents. 
3) Click on Contents -> MacOS
4) Open a terminal and drag the "Presonus TheatreMix" file into the terminal
5) Type a space then "**--inspect=9229**"
6) The app is running and the debug log is now showing in the terminal

### Example:
```bash
/Applications/Presonus\ TheatreMix.app/Contents/MacOS/Presonus\ TheatreMix --inspect=9229
```