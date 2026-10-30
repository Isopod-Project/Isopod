# 🚀 Getting Started with Isopod

Welcome to **Isopod**! This guide will help you get your Minecraft Instance Manager up and running.

## 📋 Prerequisites
- **Docker**: [Install Docker](https://docs.docker.com/get-docker/)
- **Docker Compose**: [Install Docker Compose](https://docs.docker.com/compose/install/)

## 🛠 Installation
1. **Clone the project:**
   ```bash
   git clone https://github.com/Isopod-Project/Isopod.git
   ```
2. **Launch the service:**
   ```bash
   docker compose -f isopod-compose.yml up -d --build
   ```
   On macOS, see [Running on macOS](#-running-on-macos) instead.
3. **Open the Dashboard:**
   Navigate to [http://localhost:8000](http://localhost:8000) in your web browser.

## 🍎 Running on macOS
`isopod-compose.yml` stores data under `/DATA/AppData/isopod`, a CasaOS path that doesn't exist on a Mac. Docker Desktop can only mount folders it shares with containers (your home folder by default). The macOS overlay `docker/isopod-compose.macos.yml` swaps in Mac-friendly locations.

**One-time setup:** create a file named `.env` in the root of your clone so Docker Compose always loads the overlay:

```bash
echo "COMPOSE_FILE=isopod-compose.yml:docker/isopod-compose.macos.yml" > .env
```

From then on, run plain `docker compose` commands without any `-f` flags:

```bash
docker compose up -d --build   # start or update
docker compose down            # stop
docker compose logs -f         # watch logs
```

> Don't add `-f isopod-compose.yml`: any `-f` flag makes Docker Compose ignore the `.env` setting and skip the overlay, and the start fails with `mounts denied`. To skip the `.env` file, pass both files on every command: `docker compose -f isopod-compose.yml -f docker/isopod-compose.macos.yml up -d --build`.

Server folders and worlds are stored in `data/servers` inside your clone. Docker images that Isopod downloads, like `itzg/minecraft-server`, go in a Docker volume named `isopod_isopod-docker`. Keep the clone under your home folder, or add its location in Docker Desktop under **Settings → Resources → File sharing**.

## 🔐 Logging In
The first time you open the dashboard, Isopod asks you to create the admin account. Open it right after you start Isopod: until the account exists, anyone who can reach port 8000 can create it. After that, every visit and every API call needs a login. Sessions last 30 days.

To change the password or log out, open **Settings → Account**. Changing the password logs out every other browser.

**Forgot the password?** Delete `.isopod_auth.json` from your servers folder (`/DATA/AppData/isopod/servers` on CasaOS, `data/servers` on macOS) and reload the dashboard to set up the account again. Your servers aren't affected.

## 🦀 Features at a Glance
- **Instance Creation**: Quickly spin up new Minecraft servers. Pick a **Group** in the Add Instance window (or **+ New Group...**) to file the new server under it; right-click a server and choose **Move to Folder** to change it later.
- **Modpacks**: Create a server from a **Modrinth** or **CurseForge** modpack. CurseForge needs a free API key, see [CurseForge Modpacks](#-curseforge-modpacks).
- **Mod Management**: Search and install mods directly from Modrinth. Mods install as soon as you click **Add**.
- **Desktop-Grade File Explorer**: Right-click context menus, drag-and-drop file moves & direct OS uploads, breadcrumb navigation, inline renaming/creation, multi-select, and conflict resolution.
- **Live Console**: Watch your server logs in real-time.
- **RCON Support**: Send commands to your server without leaving the dashboard. If a command fails, it stays in the input box so you can retry it, and the console shows why.
- **Resource Usage**: See live CPU and RAM use for each running server and for all of them combined.

## 📂 File Explorer Shortcuts & Actions
- **Right-Click**: Access context menus for quick actions (New File, New Folder, Rename, Delete, Cut, Copy, Paste, Download).
- **Drag & Drop**: Drag files and folders into directories or breadcrumbs to move them; drag files directly from your computer to upload.
- **Keyboard Shortcuts**:
  - `Delete`: Delete selected files.
  - `F2`: Inline rename selected item.
  - `Ctrl + C` / `Ctrl + X` / `Ctrl + V`: Copy, cut, and paste files.
  - `Ctrl + A`: Select all items.
  - `Esc`: Cancel inline editing or dismiss context menu.

## 🧱 Server Types
Pick a server type when you add an instance, or change it later in the Edit window's **Loaders** tab. (For Bedrock servers, see [Bedrock Edition](#-bedrock-edition).) Each type lets you pin a loader version or build, or use **Latest Recommended**.
- **Mod servers**: Fabric, Forge, NeoForge, and Quilt load mods from the `mods` folder.
- **Plugin servers**: Paper, Purpur, and Folia load plugins from the `plugins` folder. On these servers the **Mods** tab manages plugins instead: its header reads **Plugins**, and **Download Plugins** searches Modrinth for plugins that run on that server type.
  - **Paper** runs Paper, Spigot, and Bukkit plugins.
  - **Purpur** is a Paper fork with extra gameplay and config options. It runs the same plugins as Paper, plus Purpur-only ones.
  - **Folia** runs each region of the world on its own thread, for large servers on machines with many CPU cores. Most Paper plugins don't work on Folia, so the plugin search only shows plugins marked Folia-compatible. Folia only exists for some Minecraft versions (1.19.4 and newer), and all its builds are experimental; Isopod warns you if the version you picked has no Folia build.

## 🔥 CurseForge Modpacks
Isopod can create a server from any CurseForge modpack. CurseForge only serves its API to apps with a key, so you set one up once.

**1. Get a key.** Sign in at [console.curseforge.com](https://console.curseforge.com) and create an API key. It's free.

**2. Give it to Isopod.** Add it to the `.env` file in the root of your clone. Put it in single quotes, because keys contain `$` characters:
```env
CURSEFORGE_API_KEY='your-key-here'
```
On macOS, add it to the same `.env` that holds `COMPOSE_FILE`. On CasaOS, add `CURSEFORGE_API_KEY` under **Environment Variables** instead. If you paste it into the compose YAML, write every `$` as `$$`.

**3. Restart Isopod** so it picks the key up:
```bash
docker compose -f isopod-compose.yml up -d
```

**Create a server.**
1. Large packs need several GB of RAM, and new servers get **Default RAM Allocation** from Isopod's **Settings** (1G unless you changed it). Raise it before you create the server.
2. Click **Add Instance** and open the **CurseForge** tab.
3. Search for a pack and click it. The newest release is selected for you, or pick another version from the list.
4. Name the server and continue, then start it. The first start downloads the pack and all of its mods, so it can take several minutes. Follow it in the **Logs** tab.

The Minecraft version, loader, and Java version all come from the pack. Isopod skips well-known client-only mods (shaders, minimaps, menu mods, and similar) so they don't crash the server.

**Good to know**
- CurseForge support covers **modpacks**. The **Mods** tab still searches Modrinth only.
- If the CurseForge tab shows **Couldn't load modpacks**, read the message under it. `CURSEFORGE_API_KEY is not set` means the key never reached Isopod; recheck step 2 and restart. A `403` means CurseForge rejected the key.
- Some pack authors block downloads outside the CurseForge app. Isopod can't install those packs, and the server log names the mod that failed.
- Keep the key private. Isopod only sends it to `api.curseforge.com` and passes it to your server's container as an environment variable. It isn't written to the instance's `docker-compose.yml`.

## 📱 Bedrock Edition
Isopod can host players on Minecraft for Windows, phones, tablets, and consoles in two ways.

**A Bedrock server.** Pick **BEDROCK** as the server type in the Add Instance window. Isopod runs Mojang's Bedrock Dedicated Server, so only Bedrock players can join.
- The port switches to `19132`, the standard Bedrock port. Bedrock uses **UDP**, so forward the port as UDP on your router.
- Choose **Latest release** or **Preview** (for players on Minecraft Preview). To stay on one release, type its exact number, like `1.21.50.07`, in the **Versions** tab.
- World types are Default, Flat, and Legacy. Bedrock has no Spectator game mode or structures switch.
- The whitelist (Bedrock calls it the allowlist) takes Xbox gamertags, spaces included. Manage it later in the **User Management** tab: add or remove players, turn the allowlist on or off, and make players operators. Changes reach a running server straight away, except that a new operator who isn't online gets operator powers at the next start.
- Bedrock has no ban command, so there's no Banned Players list. To keep someone out, turn the allowlist on and remove them from it.
- Bedrock servers can't run Java mods or plugins, so the Edit window has no **Loaders** or **Resource Packs** tab, and the **Mods** tab is called **Add-ons**. The online player list and player count work as they do on Java, but the side panel only lists names: kick, message, and teleport need RCON, which Bedrock doesn't have.
- **Add-ons**: click **Add File** and pick a `.mcpack` or `.mcaddon`. Isopod installs its behavior packs (and the resource packs a `.mcaddon` brings with them) and turns them on for the world. Each add-on shows its name, version, and type; switch one off to keep it installed but unused, or remove it to delete it. Changes apply the next time the server starts.
  - Add-ons marked **Uses experimental Beta APIs** only work in a world that has the Beta APIs experiment on. Experiments are set when a world is created in the game, so turn it on there and upload that world.
  - Files that aren't valid add-ons, or that try to write outside their folder, are rejected with the reason. Marketplace content is encrypted and can't be installed.
- Backups and snapshots include the `worlds` folder. While the server is running, Isopod pauses saving for a few seconds so the copy is consistent.

**Cross-play on a Java server.** Open a Paper, Purpur, Fabric, or NeoForge server's **Loaders** tab and switch on **Bedrock cross-play**, then **Save Changes** and restart the server.
- Isopod installs [Geyser](https://geysermc.org) (which translates between Bedrock and Java) and Floodgate (which lets Bedrock players join without a Java account). On Fabric it also adds Fabric API, which both need.
- Bedrock players join on the **Bedrock port** (UDP, `19132` by default). The sidebar and the Edit window's status bar show it as **Bedrock** next to the Java address.
- Bedrock players' names start with a `.` so they can't clash with Java names.
- Geyser supports the newest Java releases. On an older Minecraft version, Bedrock players may not be able to join.
- Switching cross-play off removes the Geyser and Floodgate jars and the Bedrock port. Their config folders stay, in case you turn it back on.

Isopod publishes UDP ports `19132`-`19152` for Bedrock, so keep Bedrock ports in that range. If you installed Isopod before this feature, add `19132-19152:19132-19152/udp` to the ports in your compose file (see [the CasaOS guide](../CASAOS_INSTALL.md)).

## 💾 Saving in the Edit Window
- **Mods tab** (**Add-ons** on Bedrock): Every change applies right away. **Add** downloads the mod (it shows **Installing...** until it's done), and enabling, disabling, or removing a mod changes its file immediately. There is nothing to save.
- **User Management**: Player changes and the **Whitelist** switch are saved with **Save User Configuration**, and **Discard Changes** undoes them.
- **Everything else** (version, loader, configuration) waits for **Save Changes**. The sidebar shows **Unsaved Changes** while something is waiting.
- Closing the Edit window with anything unsaved asks **Discard N unsaved changes?** Choose **Keep editing** to go back and save.

## 🧩 Selecting Multiple Mods
In a server's **Mods** tab you can select several mods and enable, disable, or remove them together.
- **Click** a mod to select only that mod. **Double-click** it to turn it on or off.
- **Ctrl + Click** (`Cmd + Click` on Mac) adds or removes one mod from the selection.
- **Shift + Click** selects every mod between the last one you clicked and this one.
- **Ctrl + A** (`Cmd + A`) selects every mod that matches the search box.
- **Esc**, or a click on the empty space below the list, clears the selection. `Delete` removes the selected mods.
- With more than one mod selected, the header shows how many are selected, and **Enable**, **Disable**, and **Remove** show how many mods they will change. For example, if you select 3 enabled mods and 1 disabled mod, the buttons read **Disable (3)** and **Enable (1)**. **Remove** asks you to confirm once for all of them.
- Mods hidden by the search box are left out of the selection, so a batch action never changes a mod you can't see.

## 📊 Resource Usage
Live usage updates every few seconds while **Automatic Refresh** is on in Settings, and whenever you press **Refresh**.
- **All servers**: The top bar shows total CPU and RAM for every running server, with RAM shown against your machine's total memory (e.g. `3.1/16 GB`). It is hidden on screens narrower than 1366px to keep the top bar from wrapping.
- **One server**: Select a running server to see its CPU and RAM in the side panel. Running servers also show their RAM under their tile.
- **CPU** is a share of your whole machine: 100% means every core is busy. Minecraft mostly runs on one core, so a busy server on an 8-core machine shows around 12%.
- **RAM** is shown as `2.2 GB used · 2.0 GB heap`. The heap is the memory set aside for Minecraft's world data: **Default RAM Allocation** in Settings when the server was created, or `MEMORY` in its raw environment config. Java needs extra memory on top of it, so using 10–30% more than the heap is normal and not a sign the server is over its limit.

## ⏪ Pre-update Snapshots
Before you change a server's Minecraft version, server type, loader version, modpack, or mods (adding, removing, enabling, or disabling them), Isopod takes a snapshot of its worlds, `mods`, `config`, and `plugins` folders, `server.properties`, and its Docker settings. Several changes within 10 minutes share one snapshot, taken before the first change.
- **Roll back**: After an update, the server's side panel shows **Restore previous state**. It stops the server if it's running and puts everything back as it was before the update. Anything that changed since, including world progress, is lost. **Dismiss** hides the offer; the snapshot stays in the **Backups** tab.
- The offer goes away on its own once the server has started successfully after the change.
- **Manage snapshots**: The **Backups** tab lists every snapshot with the change it was taken before, and you can download, restore, or delete them like backups. **Snapshots to keep** sets how many are kept (3 by default); the oldest are removed first. Set it to **0** to turn snapshots off.
- If a snapshot can't be taken (for example, the disk is full), the change is not made and Isopod tells you why.

## 💥 Crashes and Auto-Restart
Isopod watches for servers that stop on their own. Stopping or killing a server from the dashboard never counts as a crash, and neither does a clean `/stop` from inside the game.
- **Crashed servers** show a red **Crashed (Code: X)** badge on their tile (or **Out of memory** when the server ran out of RAM), and the side panel explains what happened.
- **Restart automatically** (Edit window → **Configuration**) controls what happens next. It's saved with **Save Changes** and takes effect the next time the server starts:
  - **Always** (default): restarts after a crash, after a clean stop from inside the game, and when your computer or Docker restarts.
  - **Only after a crash**: restarts only when the server crashes.
  - **Never**: the server stays stopped until you start it.
- **Crash loops**: Docker waits a little longer before each quick restart. If a server still crashes 3 times within 2 minutes, Isopod stops it so a broken mod or world can't restart it forever, and the side panel says **Crash loop stopped**. Fix the problem, then press **Launch** to start it again.
- A server that crashed and came back on its own shows a note in the side panel until you **Dismiss** it or start it yourself.
- **View Crash Report** (or **Crash Report** in the Edit window's **Logs** tab) opens the newest file from `crash-reports/`. It shows what crashed, the root cause (the last `Caused by:` line), and any mods the report names as suspects, with the full report below it. Crashes that write no report, such as running out of memory or a port already in use, show the last log lines instead.

## 💤 Sleep When Empty
A Java server can pause itself when nobody is playing, so it stops using CPU.
- Turn on **Sleep when empty** in the Edit window's **Configuration** tab and pick how many minutes it waits (10 by default). The timer starts when the last player leaves, or at startup if nobody joins. It takes effect the next time the server starts.
- Before pausing, the server saves the world. While it's paused, its tile shows a blue dot and the side panel says **Sleeping**.
- To wake it, connect to it in Minecraft, or just refresh your server list. It resumes within a few seconds and the join goes through as normal. A wake from a server-list refresh that nobody follows up on lets it go back to sleep after about 2 minutes.
- Stopping a sleeping server from the dashboard wakes it first, so it shuts down cleanly.
- A paused server still holds its RAM, though your computer can move it out to disk. Stop the server if you need the memory back.
- Not available for Bedrock servers.

## 🔌 Lost Connection
The dashboard checks every few seconds that it can still reach the Isopod backend, even with **Automatic Refresh** off. If two checks in a row fail, a **Lost connection to Isopod** banner appears and every server shows **Unknown**, because its last known status can't be trusted. Once the backend is reachable again, the banner clears and statuses reload on their own; **Retry** checks right away. If the dashboard can't reach the backend when it first loads, it shows **Can't reach Isopod** instead of an empty server list.

## ❓ Need Help?
Check the [wiki](https://isopod-project.github.io/Isopod-Website/#/wiki) or [open an issue](https://github.com/Isopod-Project/Isopod/issues) on GitHub.
