import hashlib
import io
import json
import zipfile

t = "Yam shel Shelomoh on Beitzah"
base = r"C:\Users\morde\Soferia\export-v7"
p = base + "\\_search\\" + t + ".txt"
lines = io.open(p, encoding="utf-8").read().splitlines()
refs = [line.split("\t")[0] for line in lines]
print("total", len(lines),
      "ch1", sum(1 for r in refs if " 1:" in r),
      "ch2", sum(1 for r in refs if " 2:" in r),
      "ch3", sum(1 for r in refs if " 3:" in r))
print("first 3", refs[:3])

z = zipfile.ZipFile(base + "\\" + t + ".zip")
m = json.loads(z.read(t + " 1.metadata.json"))
print("ch1 subs", list(m["sections"])[:3])
sub = m["sections"][t + " 1:1"]
print("sub versions", sub["versions"][:2])
v = sub["versions"][0]
h = hashlib.md5(v["versionTitle"].encode()).hexdigest()[:8]
n = t + " 1." + h + "." + v["language"] + ".json"
print("file", n, "in zip", n in z.namelist())
d = json.loads(z.read(n))
print("payload keys", list(d))
text = d["sections"].get(t + " 1:1")
print("text type", type(text).__name__,
      len(text) if hasattr(text, "__len__") else "", repr(text)[:120])
