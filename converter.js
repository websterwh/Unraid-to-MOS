/*
 * converter.js - Unraid docker template (XML) -> MOS Hub docker template (JSON)
 *
 * Same conversion logic as unraid2mos.py, ported to plain JS so it can run
 * client-side on GitHub Pages with no server and no build step. Works both
 * as a browser <script> (exposes window.UnraidToMos) and under Node (module.exports)
 * for testing.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = mod;
  }
  if (typeof window !== "undefined") {
    window.UnraidToMos = mod;
  }
})(this, function () {
  "use strict";

  const MOS_CATEGORIES = [
    "AI", "Backup", "Crypto", "Downloader", "Driver", "Game Server",
    "Home Automation", "Hosting", "Media", "Monitoring", "Network",
    "Productivity", "Security", "System", "Utilities", "Misc",
  ];

  const CATEGORY_KEYWORDS = [
    ["Home Automation", ["homeautomation", "home automation", "smarthome", "home assistant", "domoticz", "zigbee", "mqtt"]],
    ["Game Server", ["gameserver", "game server", "steamcmd", "minecraft"]],
    ["Downloader", ["download", "usenet", "torrent", "nzb"]],
    ["Media", ["mediaapp", "media", "plex", "jellyfin", "video", "music", "photo", "movie", "audiobook"]],
    ["Backup", ["backup", "archive"]],
    ["Driver", ["driver", "nvidia", "coral", " gpu"]],
    ["AI", ["machine learning", "artificial intelligence", " llm", "large language model"]],
    ["Crypto", ["crypto", "blockchain", "mining", "bitcoin"]],
    ["Network", ["network", "vpn", "proxy", "dns", "firewall", "tunnel"]],
    ["Security", ["security", "auth", "sso", "identity provider", "intrusion"]],
    ["Monitoring", ["monitor", "statistics", "dashboard", "uptime", "analytics", "log viewer"]],
    ["Productivity", ["productivity", "office", "recipe", "note"]],
    ["Hosting", ["hosting", "webserver", "reverse proxy", "cms", "cloud storage", "file sync"]],
    ["System", ["system:", "utilit", "management", "container management"]],
  ];

  const SECONDARY_CATEGORY_RULES = [
    ["Network", ["home assistant", "zigbee", "mqtt", "smarthome"], "Home Automation"],
  ];

  const ID_VAR_TARGETS = new Set(["PUID", "PGID", "GUID", "GID", "UID", "USER_ID", "GROUP_ID"]);

  const BBCODE_TAG_RE = /\[\/?(?:b|u|i|span|br|url|img)[^\]]*\]/gi;

  function guessCategory(raw) {
    if (!raw) return { categories: ["Misc"], warnings: ["no <Category> found, defaulted to Misc"] };
    const low = ` ${raw.toLowerCase()} `;
    for (const [mosCat, keywords] of CATEGORY_KEYWORDS) {
      if (keywords.some((kw) => low.includes(kw))) {
        const cats = [mosCat];
        for (const [primary, secondaryKeywords, secondaryCat] of SECONDARY_CATEGORY_RULES) {
          if (mosCat === primary && !cats.includes(secondaryCat) && secondaryKeywords.some((kw) => low.includes(kw))) {
            cats.push(secondaryCat);
          }
        }
        return { categories: cats, warnings: [`guessed category [${cats.join(", ")}] from Unraid category '${raw.trim()}' - please verify`] };
      }
    }
    return { categories: ["Misc"], warnings: [`could not map Unraid category '${raw.trim()}' -> defaulted to Misc, please review`] };
  }

  function stripShellQuotes(text) {
    if (!text) return text;
    return text.replace(/["']/g, "");
  }

  function cleanText(text) {
    if (!text) return "";
    return text.replace(BBCODE_TAG_RE, " ").replace(/\s+/g, " ").trim();
  }

  function directChild(el, tag) {
    for (const child of Array.from(el.children || [])) {
      if (child.tagName === tag) return child;
    }
    return null;
  }

  function directChildren(el, tag) {
    return Array.from(el.children || []).filter((c) => c.tagName === tag);
  }

  function textOf(el, tag, fallback) {
    fallback = fallback === undefined ? "" : fallback;
    const child = directChild(el, tag);
    if (!child || child.textContent === null) return fallback;
    return child.textContent.trim();
  }

  function boolOf(el, tag, fallback) {
    const val = textOf(el, tag, "").trim().toLowerCase();
    if (["true", "1", "yes"].includes(val)) return true;
    if (["false", "0", "no", ""].includes(val)) return fallback;
    return fallback;
  }

  function rewriteHostPath(path, pool, oldPools) {
    if (!path) return path;
    const names = ["user0?", "cache", "disk\\d+"];
    for (const p of oldPools || []) {
      if (p) names.push(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
    const pattern = new RegExp("^/mnt/(" + names.join("|") + ")/");
    return path.replace(pattern, `/mnt/${pool}/`);
  }

  function convertConfigEntries(root, pool, oldPools, rewritePaths, normalizeIds, puid, pgid, warnings) {
    const paths = [], ports = [], variables = [], devices = [], labels = [];

    for (const cfg of directChildren(root, "Config")) {
      const cfgType = (cfg.getAttribute("Type") || "Variable").split(",")[0].trim().toLowerCase();
      const name = cfg.getAttribute("Name") || cfg.getAttribute("Target") || "Unnamed";
      const target = cfg.getAttribute("Target") || "";
      const mode = cfg.getAttribute("Mode") || "";
      const description = cleanText(cfg.getAttribute("Description") || "");
      const required = (cfg.getAttribute("Required") || "false").trim().toLowerCase() === "true";
      const mask = (cfg.getAttribute("Mask") || "false").trim().toLowerCase() === "true";
      const defaultAttr = cfg.getAttribute("Default") || "";
      const value = (cfg.textContent || "").trim() || defaultAttr;

      if (cfgType === "path") {
        let host = value || defaultAttr;
        if (rewritePaths) {
          const newHost = rewriteHostPath(host, pool, oldPools);
          if (newHost !== host) warnings.push(`path '${name}': rewrote host path '${host}' -> '${newHost}'`);
          host = newHost;
        }
        paths.push({ name, host, container: target, mode: mode || "rw", description: description || null, required });
      } else if (cfgType === "port") {
        const protocol = (mode || "tcp").toLowerCase();
        ports.push({
          name,
          host: value || target,
          container: target,
          protocol: ["tcp", "udp"].includes(protocol) ? protocol : "tcp",
          description: description || null,
          required,
          mask,
        });
      } else if (cfgType === "device") {
        devices.push({ name, host: value, container: target, description: description || null, required });
      } else if (cfgType === "label") {
        labels.push({ name, value, description: description || null });
      } else {
        // "variable" and anything unrecognized
        const key = target || name;
        let val = value;
        if (normalizeIds && ID_VAR_TARGETS.has(key.toUpperCase())) {
          const newVal = ["PGID", "GID", "GROUP_ID", "GUID"].includes(key.toUpperCase()) ? pgid : puid;
          if (newVal !== val) warnings.push(`variable '${key}': normalized default '${val}' -> '${newVal}'`);
          val = newVal;
        }
        variables.push({ name, key, value: val, description: description || null, required, mask });
      }
    }

    return { paths, ports, variables, devices, labels };
  }

  function stripCompact(value) {
    if (Array.isArray(value)) return value.map(stripCompact);
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) out[k] = stripCompact(v);
      }
      return out;
    }
    return value;
  }

  function convertTemplate(xmlText, options) {
    const opts = Object.assign(
      { pool: "cache", oldPools: ["sandisk"], rewritePaths: true, normalizeIds: true, puid: "500", pgid: "500", compact: false },
      options || {}
    );
    const warnings = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");

    const parserError = doc.getElementsByTagName("parsererror")[0];
    if (parserError) {
      throw new Error("Could not parse XML: " + parserError.textContent.trim().split("\n")[0]);
    }

    const root = doc.documentElement;
    if (!root || root.tagName !== "Container") {
      throw new Error(`Not an Unraid container template (root tag is <${root ? root.tagName : "?"}>, expected <Container>)`);
    }

    const name = textOf(root, "Name");
    if (!name) throw new Error("Template has no <Name> - cannot convert");

    const repo = textOf(root, "Repository");
    if (!repo) warnings.push("no <Repository> found - 'repo' will be empty, fill it in manually");

    const registry = textOf(root, "Registry") || null;
    const network = textOf(root, "Network", "bridge") || "bridge";
    const privileged = boolOf(root, "Privileged", false);
    const shell = textOf(root, "Shell", "bash") || "bash";

    const extraParamsRaw = textOf(root, "ExtraParams") || null;
    let extraParams = extraParamsRaw ? stripShellQuotes(extraParamsRaw) : null;
    if (extraParams !== extraParamsRaw) warnings.push(`extra_parameters: stripped shell-style quotes '${extraParamsRaw}' -> '${extraParams}'`);

    const postArgsRaw = textOf(root, "PostArgs") || null;
    let postArgs = postArgsRaw ? stripShellQuotes(postArgsRaw) : null;
    if (postArgs !== postArgsRaw) warnings.push(`post_parameters: stripped shell-style quotes '${postArgsRaw}' -> '${postArgs}'`);

    const cpuSet = textOf(root, "CPUset") || null;
    let webUi = textOf(root, "WebUI") || null;
    const icon = textOf(root, "Icon") || null;
    const project = textOf(root, "Project") || null;
    const overview = cleanText(textOf(root, "Overview")) || cleanText(textOf(root, "Description"));
    const categoryRaw = textOf(root, "Category");

    const { categories, warnings: catWarnings } = guessCategory(categoryRaw);
    warnings.push(...catWarnings);

    const { paths, ports, variables, devices, labels } = convertConfigEntries(
      root, opts.pool, opts.oldPools, opts.rewritePaths, opts.normalizeIds, opts.puid, opts.pgid, warnings
    );

    if (!webUi && ports.length) {
      webUi = `http://[IP]:[PORT:${ports[0].host}]`;
      warnings.push(`no <WebUI> found - built a guess from the first port: ${webUi}`);
    }

    let template = {
      name,
      repo,
      category: categories,
      registry,
      network,
      custom_ip: null,
      default_shell: shell,
      privileged,
      extra_parameters: extraParams,
      post_parameters: postArgs,
      web_ui_url: webUi,
      icon,
      project,
      description: overview || null,
      paths,
      ports,
      variables,
      devices,
      labels,
    };
    if (cpuSet) template.cpu_set = cpuSet;
    if (opts.compact) template = stripCompact(template);

    return { template, warnings };
  }

  function slugifyFilename(name) {
    const cleaned = (name || "").replace(/[^A-Za-z0-9]+/g, "");
    return cleaned || "Template";
  }

  return {
    MOS_CATEGORIES,
    guessCategory,
    stripShellQuotes,
    rewriteHostPath,
    convertTemplate,
    slugifyFilename,
  };
});
