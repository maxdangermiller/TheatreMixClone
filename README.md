# Presonus Theatre Mix
**Created By:** Max Miller

This repository is a Node.js based implementation of [TheatreMix](https://www.theatremix.com) created by James Holt. It takes in a TheatreMix file (.tmix) and allows using some features that TheatreMix supports on other consoles.

This software was developed due to the lack of support for PreSonus StudioLive consoles in TheatreMix. It is not intended to infringed on any intellectual property of Mixing Technology Pty Ltd, and still requires using the original TheatreMix app to program, this app simply translates the TheatreMix file into something the StudioLive consoles respond to.

The app uses Electron.js alongside React.js. The presonus interface is based off of @featherbear's [presonus-studiolive-api](https://github.com/featherbear/presonus-studiolive-api)

## Usage
First Install Homebrew (You have already done this)

You **CAN** copy and paste these commands

### INSTALL
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
