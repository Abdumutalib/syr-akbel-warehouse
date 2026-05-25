import os
import glob

html_files = glob.glob("public/*.html")
for path in html_files:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    original = content

    if "noindex" not in content and "<head>" in content:
        content = content.replace("<head>", "<head>\n  <meta name=\"robots\" content=\"noindex, nofollow\">", 1)
        
    if "viewport" not in content and "<head>" in content:
         content = content.replace("<head>", "<head>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">", 1)

    if "min-height: 48px;" not in content and "</head>" in content:
        ux_style = """
  <style>
    button, a.btn, input[type="button"], input[type="submit"], select, .secondary, .primary {
      min-height: 48px !important;
      min-width: 48px !important;
    }
    body, input, select, textarea, button {
      font-size: 14px !important;
    }
    body {
      max-width: 100%;
      overflow-x: hidden;
    }
  </style>
"""
        content = content.replace("</head>", ux_style + "</head>", 1)
    
    if original != content:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Updated {path}")
