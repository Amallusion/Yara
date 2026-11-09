"""Build dist/worker.js: Yara's chat Worker with the knowledge files built in.

Run from the yara-chat folder:  python tools/build_worker.py
Then paste worker.js into the Cloudflare Worker editor and click Deploy.
Each ### section of each knowledge file becomes one searchable section.
"""
import json, pathlib, datetime, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ["yara-recipe-index.md", "yara-recipes.md", "yara-ingredients.md",
         "yara-myplate-vegan-recipes.md", "yara-saudi-context.md"]

sections = []
for name in FILES:
    text = (ROOT / "knowledge" / name).read_text(encoding="utf-8")
    for block in re.split(r"(?m)^### ", text):
        block = block.strip()
        if not block:
            continue
        title, _, body = block.partition("\n")
        sections.append({"file": name, "title": title.strip(), "text": body.strip()})

template = (ROOT / "src" / "worker.template.js").read_text(encoding="utf-8")
built = template.replace("__KNOWLEDGE__", json.dumps(sections, ensure_ascii=False, indent=0)) \
                .replace("__BUILT__", datetime.date.today().isoformat())
built = built.replace("\nexport { retrieve, priceLookup, parseCSV, wantsPrice };\n", "\n")
(ROOT / "worker.js").write_text(built, encoding="utf-8")
print(f"worker.js: {len(sections)} sections, {len(built.encode('utf-8')) // 1024} KB")
