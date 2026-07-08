#!/usr/bin/env python3
"""Deterministic sanity checks over a KiCad netlist export.

Input:  a netlist produced on the design machine with
        kicad-cli sch export netlist -o board.net board.kicad_sch
        (default kicadsexpr format)

Usage:  python3 netlist_checks.py board.net [--json]
        python3 netlist_checks.py board.net --diff prev_rev.net [--json]
          (adds a rev-to-rev change summary: components added/removed,
           value changes, and pins that moved to a different net)

Checks that are pure graph facts and should never be left to judgment:
  - PMOS source pin sits on a supply-like net (high-side usage)
  - NMOS source pin sits on a GND-like net (low-side usage)
  - MOSFET gate is not floating (gate net has at least one other node)

Everything else (protection presence, decoupling, etc.) is evaluated by the
review layer reading rules/*.md — this script only reports facts.
"""
import json
import re
import sys

# ---------------------------------------------------------------- s-expr


def parse_sexpr(text):
    tokens = re.findall(r'"(?:[^"\\]|\\.)*"|[()]|[^\s()"]+', text)
    pos = 0

    def walk():
        nonlocal pos
        node = []
        assert tokens[pos] == "("
        pos += 1
        while tokens[pos] != ")":
            if tokens[pos] == "(":
                node.append(walk())
            else:
                tok = tokens[pos]
                if tok.startswith('"'):
                    tok = tok[1:-1].replace('\\"', '"')
                node.append(tok)
                pos += 1
        pos += 1
        return node

    return walk()


def find_all(node, tag):
    return [c for c in node if isinstance(c, list) and c and c[0] == tag]


def find_one(node, tag, default=None):
    hits = find_all(node, tag)
    return hits[0] if hits else default


def atom(node, tag, default=""):
    hit = find_one(node, tag)
    return hit[1] if hit and len(hit) > 1 else default


# ---------------------------------------------------------------- classify

GND_RE = re.compile(r"^\/?([A-Za-z0-9_.\/]*\/)?(GND[A-Z0-9]*|[ADP]GND|VSS[A-Z0-9]*|0V?)$", re.I)
SUPPLY_RE = re.compile(
    r"^\/?([A-Za-z0-9_.\/]*\/)?(\+[0-9]+V[0-9]*|VCC\w*|VDD\w*|VBUS\w*|VBAT\w*|VIN\w*|VSYS\w*|"
    r"V?[0-9]+V[0-9]*(_[A-Z0-9]+)?|PWR\w*|VMOT\w*|VS)$",
    re.I,
)
PMOS_RE = re.compile(r"p[\s\-_]?(channel|chan|ch)\b|\bpmos\b|\bp-?fet\b|mosfet[\s,]*p", re.I)
NMOS_RE = re.compile(r"n[\s\-_]?(channel|chan|ch)\b|\bnmos\b|\bn-?fet\b|mosfet[\s,]*n", re.I)


def classify_net(name):
    if GND_RE.match(name):
        return "gnd"
    if SUPPLY_RE.match(name):
        return "supply"
    return "signal"


# ---------------------------------------------------------------- main


def design_meta(root):
    """Extract source file, export date, and title-block info from the design section.
    The KiCad title-block 'Rev' field (File > Page Settings > Revision) holds the
    board VERSION in our scheme (V1, V1.1, V2 — compatibility statement). The
    review REVISION (0, 1, 2 — iterations within a version) is tracked by the
    pipeline, not the title block."""
    design = find_one(root, "design", [])
    meta = {
        "source": atom(design, "source"),
        "export_date": atom(design, "date"),
        "tool": atom(design, "tool"),
        "title": "", "version": "", "company": "", "sheet_date": "",
    }
    for sheet in find_all(design, "sheet"):
        tb = find_one(sheet, "title_block")
        if tb is None:
            continue
        meta["title"] = meta["title"] or atom(tb, "title")
        meta["version"] = meta["version"] or atom(tb, "rev")
        meta["company"] = meta["company"] or atom(tb, "company")
        meta["sheet_date"] = meta["sheet_date"] or atom(tb, "date")
        if meta["title"] and meta["version"]:
            break
    return meta


def load_netlist(path):
    """Parse a netlist into (comps, pin_net) for checking and diffing."""
    root = parse_sexpr(open(path, encoding="utf-8").read())
    comps = {}
    for c in find_all(find_one(root, "components", []), "comp"):
        comps[atom(c, "ref")] = atom(c, "value")
    pin_net = {}
    for net in find_all(find_one(root, "nets", []), "net"):
        name = atom(net, "name")
        for nd in find_all(net, "node"):
            pin_net[(atom(nd, "ref"), atom(nd, "pin"))] = name
    return comps, pin_net


def diff_netlists(old_path, new_path):
    """Rev-to-rev change summary between two netlist exports."""
    old_c, old_p = load_netlist(old_path)
    new_c, new_p = load_netlist(new_path)
    added = sorted(set(new_c) - set(old_c))
    removed = sorted(set(old_c) - set(new_c))
    value_changed = sorted(
        (r, old_c[r], new_c[r]) for r in set(old_c) & set(new_c) if old_c[r] != new_c[r]
    )
    moved = sorted(
        (r, p, old_p[(r, p)], new_p[(r, p)])
        for (r, p) in set(old_p) & set(new_p)
        if old_p[(r, p)] != new_p[(r, p)] and r not in added and r not in removed
    )
    return {
        "components_added": [{"ref": r, "value": new_c[r]} for r in added],
        "components_removed": [{"ref": r, "value": old_c[r]} for r in removed],
        "value_changes": [{"ref": r, "old": o, "new": n} for r, o, n in value_changed],
        "net_changes": [{"ref": r, "pin": p, "old_net": o, "new_net": n} for r, p, o, n in moved],
    }


def run(path):
    root = parse_sexpr(open(path, encoding="utf-8").read())

    # libpart descriptions keyed by (lib, part) for polarity detection fallback
    libdesc = {}
    for lp in find_all(find_one(root, "libparts", []), "libpart"):
        key = (atom(lp, "lib"), atom(lp, "part"))
        libdesc[key] = atom(lp, "description")

    comps = {}
    for c in find_all(find_one(root, "components", []), "comp"):
        ref = atom(c, "ref")
        libsource = find_one(c, "libsource", [])
        comps[ref] = {
            "value": atom(c, "value"),
            "part": atom(libsource, "part") if libsource else "",
            "desc": (atom(libsource, "description") if libsource else "")
            or libdesc.get((atom(libsource, "lib") if libsource else "", atom(libsource, "part") if libsource else ""), ""),
        }

    # (ref, pin) -> net ; plus pinfunction per node ; node count per net
    pin_net, pin_func, net_nodes = {}, {}, {}
    for net in find_all(find_one(root, "nets", []), "net"):
        name = atom(net, "name")
        nodes = find_all(net, "node")
        net_nodes[name] = len(nodes)
        for nd in nodes:
            key = (atom(nd, "ref"), atom(nd, "pin"))
            pin_net[key] = name
            pin_func[key] = atom(nd, "pinfunction")

    findings = []

    def fet_pin(ref, func_letter):
        """Locate a FET pin by pinfunction (S/G/D), tolerating names like 'S/Source'."""
        for (r, pin), fn in pin_func.items():
            if r == ref and fn and fn.upper().lstrip().startswith(func_letter):
                return pin_net[(r, pin)]
        return None

    for ref, info in comps.items():
        text = " ".join([info["value"], info["part"], info["desc"]])
        is_p, is_n = bool(PMOS_RE.search(text)), bool(NMOS_RE.search(text))
        has_sgd = all(fet_pin(ref, letter) is not None for letter in "SGD")
        if not (is_p or is_n):
            if has_sgd and ref.upper().startswith("Q"):
                findings.append(
                    dict(rule="mosfet-polarity-unknown", ref=ref, level="WARN",
                         detail=f"{ref} ({info['value']}) has S/G/D pins but polarity "
                                f"could not be inferred from value/description — review manually."))
            continue
        polarity = "PMOS" if is_p else "NMOS"
        src = fet_pin(ref, "S")
        gate = fet_pin(ref, "G")
        if src is None:
            findings.append(dict(rule="mosfet-topology", ref=ref, level="WARN",
                                 detail=f"{ref} ({polarity}) has no pin with pinfunction 'S' in the netlist — cannot verify topology."))
            continue
        kind = classify_net(src)
        if polarity == "PMOS" and kind != "supply":
            findings.append(dict(rule="pmos-high-side", ref=ref, level="FAIL",
                                 detail=f"{ref} PMOS source is on net '{src}' ({kind}), not a supply rail. "
                                        f"PMOS should switch high-side (source to supply). "
                                        f"Legit exceptions: reverse-polarity protection, load-side source — see rules/mosfet-topology.md."))
        if polarity == "NMOS" and kind != "gnd":
            findings.append(dict(rule="nmos-low-side", ref=ref, level="FAIL",
                                 detail=f"{ref} NMOS source is on net '{src}' ({kind}), not GND. "
                                        f"NMOS should switch low-side (source to GND). "
                                        f"Legit exceptions: bootstrap high-side drive, level shifters — see rules/mosfet-topology.md."))
        if gate is not None and net_nodes.get(gate, 0) < 2:
            findings.append(dict(rule="gate-floating", ref=ref, level="FAIL",
                                 detail=f"{ref} gate net '{gate}' has no other connection — gate is floating."))
        if not findings or findings[-1].get("ref") != ref:
            findings.append(dict(rule="mosfet-topology", ref=ref, level="PASS",
                                 detail=f"{ref} {polarity}: source on '{src}' ({kind}), gate net '{gate}' — OK."))

    summary = dict(
        design=design_meta(root),
        components=len(comps),
        nets=len(net_nodes),
        findings=findings,
        power_like_nets=sorted(n for n in net_nodes if classify_net(n) == "supply"),
        gnd_like_nets=sorted(n for n in net_nodes if classify_net(n) == "gnd"),
    )
    return summary


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    result = run(sys.argv[1])
    if "--diff" in sys.argv:
        prev = sys.argv[sys.argv.index("--diff") + 1]
        result["changes_since_prev_rev"] = diff_netlists(prev, sys.argv[1])
    if "--json" in sys.argv:
        print(json.dumps(result, indent=2))
    else:
        d = result["design"]
        print(f"design: {d['title'] or d['source'] or '(untitled)'}  version: {d['version'] or '(not set)'}  exported: {d['export_date'] or '?'}")
        print(f"{result['components']} components, {result['nets']} nets")
        print(f"supply-like nets: {', '.join(result['power_like_nets']) or '(none)'}")
        print(f"gnd-like nets:    {', '.join(result['gnd_like_nets']) or '(none)'}")
        for f in result["findings"]:
            print(f"[{f['level']:4}] {f['rule']}: {f['detail']}")
        if not result["findings"]:
            print("No MOSFETs detected — nothing to check deterministically.")
        if "changes_since_prev_rev" in result:
            ch = result["changes_since_prev_rev"]
            print("--- changes since previous rev ---")
            for c in ch["components_added"]:
                print(f"  + {c['ref']} ({c['value']})")
            for c in ch["components_removed"]:
                print(f"  - {c['ref']} ({c['value']})")
            for c in ch["value_changes"]:
                print(f"  ~ {c['ref']}: {c['old']} -> {c['new']}")
            for c in ch["net_changes"]:
                print(f"  ~ {c['ref']} pin {c['pin']}: {c['old_net']} -> {c['new_net']}")
            if not any(ch.values()):
                print("  (no connectivity or component changes)")
