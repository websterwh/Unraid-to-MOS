# unraid2mos.py

Converts Unraid Community Applications docker templates (XML) into MOS Hub docker templates (JSON), so you don't have to hand-write each one when migrating a container over.

## Requirements

Python 3.9+

## Usage

```bash
# Convert one Unraid template file you've already downloaded
python3 unraid2mos.py -i GluetunVPN.xml -o docker/

# Convert an entire folder of .xml templates at once
python3 unraid2mos.py -i ./unraid-templates/ -o docker/

# Pull a template straight from a URL (e.g. a raw GitHub link) and convert it
python3 unraid2mos.py -u https://raw.githubusercontent.com/nwithan8/unraid_templates/main/templates/gluetun.xml -o docker/
```

## What it does

- Maps top-level fields directly: `Name` -> `name`, `Repository` -> `repo`, `Registry` -> `registry`, `Network` -> `network`, `Privileged` -> `privileged`, `Shell` -> `default_shell`, `ExtraParams` -> `extra_parameters`, `PostArgs` -> `post_parameters`, `CPUset` -> `cpu_set`, `WebUI` -> `web_ui_url`, `Icon` -> `icon`, `Project` -> `project`, `Support` -> `support`, `Overview`/`Description` -> `description` (BBCode tags like `[b]`/`[span]` stripped).
- Splits every `<Config>` entry by its `Type` attribute into MOS's `paths` / `ports` / `variables` / `devices` / `labels` arrays, translating each one's attributes (`Name`, `Target`, `Default`/text value, `Mode`, `Description`, `Required`, `Mask`) into the matching MOS fields.
- Rewrites host paths from Unraid's pool conventions (`/mnt/user/...`, `/mnt/cache/...`, `/mnt/diskN/...`) to `/mnt/<pool>/...`, using `--pool` (default `main`, matching MOS's own documented example). Pass `--no-rewrite-paths` to leave paths untouched.
- Normalizes `PUID`/`PGID`/`GUID`/etc. variable defaults to `500`/`500` (MOS's recommended values) unless you pass `--no-normalize-ids` or override with `--puid`/`--pgid`.
- Guesses a single MOS category from Unraid's free-text `Category` tag using keyword matching, and always prints a warning so you double-check it — Unraid category tags are inconsistent/messy across authors and this is the part most likely to need a manual fix.
- If there's no `<WebUI>` tag, it builds a best-effort guess from the first port it finds.

## What it won't get right automatically

- **Category** is a keyword guess — always reread the printed warning and fix `docker/<App>.json`'s `"category"` if it's wrong.
- **Icon URLs** are carried over as-is; if the original Unraid icon host is Unraid-specific or dead, swap it.
- Anything Unraid-specific with no MOS equivalent (VM-backed containers, Unraid plugin hooks, etc.) needs a manual look regardless of what the script produces.
- It does **not** talk to the MOS Hub or validate against a live MOS instance — always test before publishing.

Every run prints per-file warnings (`!`) for anything worth a second look — treat those as a checklist, not noise.
