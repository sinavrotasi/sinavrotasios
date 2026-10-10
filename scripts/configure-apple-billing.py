#!/usr/bin/env python3
"""Register the local plugin after cap sync, or inspect the finished IPA."""
import argparse
import json
import plistlib
from pathlib import Path
from zipfile import ZipFile

PLUGIN_CLASS = "AppleBillingPlugin"


def configure(root):
    config_path = root / "ios/App/App/capacitor.config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    classes = config.get("packageClassList", [])
    if not isinstance(classes, list) or not all(isinstance(c, str) for c in classes):
        raise ValueError("packageClassList must be a list of class names")
    if PLUGIN_CLASS not in classes:
        classes.append(PLUGIN_CLASS)
    config["packageClassList"] = classes
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    assert PLUGIN_CLASS in json.loads(config_path.read_text())["packageClassList"]
    print("VERIFIED: AppleBillingPlugin is in the generated native packageClassList.")


def verify_ipa(path):
    with ZipFile(path) as ipa:
        configs = [n for n in ipa.namelist()
                   if n.startswith("Payload/") and n.count("/") == 2
                   and n.endswith(".app/capacitor.config.json")]
        if len(configs) != 1:
            raise ValueError("Expected one main app capacitor.config.json in IPA")
        config = json.loads(ipa.read(configs[0]))
        if PLUGIN_CLASS not in config.get("packageClassList", []):
            raise ValueError("AppleBillingPlugin missing from packaged packageClassList")
        prefix = configs[0].rsplit("/", 1)[0] + "/"
        info = plistlib.loads(ipa.read(prefix + "Info.plist"))
        executable = info["CFBundleExecutable"]
        if "/" in executable:
            raise ValueError("Invalid app executable name")
        if PLUGIN_CLASS.encode() not in ipa.read(prefix + executable):
            raise ValueError("AppleBillingPlugin class name missing from app executable")
        print("VERIFIED IPA: AppleBillingPlugin config and executable; build="
              + str(info.get("CFBundleVersion", "unknown")))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-ipa", type=Path)
    args = parser.parse_args()
    if args.verify_ipa:
        verify_ipa(args.verify_ipa)
    else:
        configure(Path(__file__).resolve().parents[1])
