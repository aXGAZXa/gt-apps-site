#!/usr/bin/env python3
"""Build pulse/privacy/index.html from Pulse's privacy policy (markdown).

Usage: python _tools/build-pulse-privacy.py [path/to/privacy-policy.md]
       (default F:/Pulse/docs/legal/privacy-policy.md)

Publishes ONLY the public policy: everything from the second top-level
"# Pulse privacy policy" heading (the first is the draft note above it) up to
the first "# Appendix" heading. Appendices A to C are internal and are never
written out; the script stops with an error if it can't find where they start.

Placeholders in [square brackets] (not links) are kept and marked visibly, and
a draft banner is shown while any remain. Any address on gt-apps.com is marked
too: that domain belongs to another company, not GT-Apps.

Standard library only; handles the markdown the policy uses (headings,
paragraphs, bullet lists, pipe tables, bold, links).
"""
import hashlib
import html
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = Path("F:/Pulse/docs/legal/privacy-policy.md")
OUT = ROOT / "pulse" / "privacy" / "index.html"
CANONICAL = "https://gt-apps.co.uk/pulse/privacy/"

placeholders: list[str] = []
flags: list[str] = []


def smart(text: str) -> str:
    """Escape for HTML and use typographic quotes, as the rest of the site does."""
    text = re.sub(r"(^|[\s(\[])\"", "\\1\u201c", text)
    text = text.replace('"', "\u201d")
    text = re.sub(r"(^|[\s(\[])'", "\\1\u2018", text)
    text = text.replace("'", "\u2019")
    return html.escape(text, quote=False)


def mark_placeholder(inner: str) -> str:
    placeholders.append(inner)
    return f'<mark class="placeholder" title="To be filled in before publishing">[{smart(inner)}]</mark>'


def email(addr: str) -> str:
    link = f'<a href="mailto:{addr}">{addr}</a>'
    if addr.lower().endswith("@gt-apps.com"):
        flags.append(addr)
        return (f'<mark class="placeholder" title="gt-apps.com is another company\'s domain">'
                f'{link} <small>(check: gt-apps.com is not ours)</small></mark>')
    return link


TOKEN = re.compile(
    r"\[([^\]]+)\]\(([^)\s]+)\)"            # 1,2 link
    r"|\[([^\]]+)\]"                         # 3 placeholder
    r"|\*\*(.+?)\*\*"                        # 4 bold
    r"|`([^`]+)`"                            # 5 code
    r"|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})"  # 6 email
)


def inline(text: str) -> str:
    out, pos = [], 0
    for m in TOKEN.finditer(text):
        out.append(smart(text[pos:m.start()]))
        if m.group(1) is not None:
            url = m.group(2)
            if "gt-apps.com" in url:
                flags.append(url)
            out.append(f'<a href="{html.escape(url)}">{inline(m.group(1))}</a>')
        elif m.group(3) is not None:
            out.append(mark_placeholder(m.group(3)))
        elif m.group(4) is not None:
            out.append(f"<strong>{inline(m.group(4))}</strong>")
        elif m.group(5) is not None:
            out.append(f"<code>{smart(m.group(5))}</code>")
        else:
            out.append(email(m.group(6)))
        pos = m.end()
    out.append(smart(text[pos:]))
    return "".join(out)


def slug(title: str) -> str:
    title = re.sub(r"^\d+\.\s*", "", title)
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def public_part(md: str) -> list[str]:
    lines = md.replace("\r\n", "\n").split("\n")
    starts = [i for i, l in enumerate(lines) if re.fullmatch(r"#\s+Pulse privacy policy\s*", l)]
    if len(starts) < 2:
        sys.exit("!! expected the draft note's heading and then the policy's own '# Pulse privacy policy'")
    start = starts[1] + 1
    ends = [i for i in range(start, len(lines)) if re.match(r"#\s+Appendix\b", lines[i])]
    if not ends:
        sys.exit("!! no '# Appendix' heading found: refusing to guess where the public policy ends")
    body = lines[start:ends[0]]
    while body and body[-1].strip() in ("", "---"):
        body.pop()
    joined = "\n".join(body)
    for word in ("Appendix", "Internal. Not for publication", "Not for publication"):
        if word in joined:
            sys.exit(f"!! '{word}' appears in the public part: check the source before building")
    return body


def render(body: list[str]) -> tuple[str, str, list[tuple[str, str]]]:
    meta, parts, toc = [], [], []
    i, n = 0, len(body)
    para: list[str] = []

    def flush():
        if para:
            lines = [s.strip() for s in para]
            # A block of short lines (the contact address) keeps its line breaks.
            if len(lines) > 1 and all(len(s) < 60 for s in lines):
                parts.append('<p class="address">' + "<br>\n".join(inline(s) for s in lines) + "</p>")
            else:
                parts.append(f"<p>{inline(' '.join(lines))}</p>")
            para.clear()

    while i < n:
        line = body[i]
        s = line.strip()
        if not s or s == "---":
            flush(); i += 1; continue
        if m := re.match(r"\*\*(Effective date|Version):\*\*\s*(.*)", s):
            flush()
            meta.append(f"<span>{m.group(1)}: {inline(m.group(2))}</span>")
            i += 1; continue
        if m := re.match(r"(#{2,4})\s+(.*)", s):
            flush()
            level = len(m.group(1))
            title = m.group(2).strip()
            sid = slug(title)
            if level == 2:
                toc.append((sid, title))
            parts.append(f'<h{level} id="{sid}">{inline(title)}</h{level}>')
            i += 1; continue
        if re.match(r"[-*]\s+", s):
            flush()
            items = []
            while i < n and re.match(r"\s*[-*]\s+", body[i]):
                item = [re.sub(r"^\s*[-*]\s+", "", body[i])]
                i += 1
                while i < n and body[i].startswith("  ") and body[i].strip() and not re.match(r"\s*[-*]\s+", body[i]):
                    item.append(body[i].strip()); i += 1
                items.append(f"<li>{inline(' '.join(item))}</li>")
            parts.append("<ul>\n" + "\n".join(items) + "\n</ul>")
            continue
        if s.startswith("|"):
            flush()
            rows = []
            while i < n and body[i].strip().startswith("|"):
                rows.append([c.strip() for c in body[i].strip().strip("|").split("|")]); i += 1
            if len(rows) < 2 or not all(re.fullmatch(r":?-+:?", c) for c in rows[1]):
                sys.exit("!! a table without a header separator row")
            head = "".join(f'<th scope="col">{inline(c)}</th>' for c in rows[0])
            trs = "\n".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows[2:])
            parts.append(f'<div class="table-wrap">\n<table>\n<thead><tr>{head}</tr></thead>\n<tbody>\n{trs}\n</tbody>\n</table>\n</div>')
            continue
        para.append(line); i += 1
    flush()
    return " ".join(meta), "\n\n".join(parts), toc


PAGE = """<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Privacy policy · Pulse · GT-Apps</title>
  <meta name="description" content="Privacy policy for Pulse, the rhythm game for iPhone and Android by GT-Apps. Your progress stays on your phone: no accounts, no adverts, no tracking.">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#1c1d1f">
  <link rel="canonical" href="{canonical}">
  <link rel="icon" href="../../favicon.png">
  <link rel="apple-touch-icon" href="../../apple-touch-icon.png">
  <link rel="preload" href="../../assets/fonts/montserrat-latin-var.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="../../style.css">
</head>
<body>
  <!-- Generated by _tools/build-pulse-privacy.py from Pulse's docs/legal/privacy-policy.md
       (sha256 {sha}, modified {mtime}). Don't edit by hand: change the policy, then rebuild. -->
  <a class="skip" href="#main">Skip to content</a>

  <header class="site-header">
    <div class="wrap">
      <a class="wordmark" href="../../" aria-label="GT-Apps, home"><b>GT-</b><span>Apps</span></a>
      <nav aria-label="Main">
        <ul>
          <li><a href="../../#apps">Apps</a></li>
          <li><a href="../../#about">About</a></li>
          <li><a href="../../#contact">Contact</a></li>
        </ul>
      </nav>
    </div>
  </header>

  <main id="main" class="legal">
    <div class="wrap">
      <div class="legal-head">
        <p class="eyebrow">Pulse</p>
        <h1>Privacy policy</h1>
        <p class="legal-meta">{meta}</p>
      </div>
{banner}
      <nav class="toc" aria-label="On this page">
        <p class="eyebrow">On this page</p>
        <ol start="0">
{toc}
        </ol>
      </nav>

      <article class="legal-body">
{body}
      </article>
    </div>
  </main>

  <footer class="site-footer">
    <!-- TODO (company): GT APPS LTD is applied for (Companies House ref 120-073083), no company number yet. Don't add "Ltd" until it is issued; then show "GT APPS LTD, registered in England and Wales, company number <number>" here. -->
    <div class="wrap">
      <p>© 2026 GT-Apps</p>
      <p class="footer-links"><a href="../../who-goes-first/privacy.html">Who Goes First? privacy</a> <a href="./" aria-current="page">Pulse privacy</a></p>
    </div>
  </footer>
</body>
</html>
"""

BANNER = """      <div class="draft-banner" role="note">
        <strong>Draft:</strong> this policy is not final. Company and ICO registration details will be
        added before release. Items marked <mark class="placeholder">[like this]</mark> are still to come.
      </div>
"""


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    raw = src.read_bytes()
    body_lines = public_part(raw.decode("utf-8"))
    meta, body, toc = render(body_lines)
    toc_html = "\n".join(
        '          <li><a href="#%s">%s</a></li>' % (sid, inline(re.sub(r"^\d+\.\s*", "", t))) for sid, t in toc)
    page = PAGE.format(
        canonical=CANONICAL,
        sha=hashlib.sha256(raw).hexdigest()[:16],
        mtime=datetime.fromtimestamp(src.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
        meta=meta,
        banner=BANNER if (placeholders or flags) else "",
        toc=toc_html,
        body="\n".join("        " + l if l else l for l in body.split("\n")),
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8", newline="\n")
    print(f"== {OUT.relative_to(ROOT)} <- {src} (sha256 {hashlib.sha256(raw).hexdigest()[:16]})")
    print(f"   sections: {len(toc)}; placeholders still to fill: {len(placeholders)}")
    for p in dict.fromkeys(placeholders):
        print(f"     [{p}]")
    if flags:
        print("   !! gt-apps.com is another company's domain; the policy uses it for:")
        for f in dict.fromkeys(flags):
            print(f"     {f}")


if __name__ == "__main__":
    main()
