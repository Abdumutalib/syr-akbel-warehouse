import os
import glob
import re

html_files = glob.glob("public/*.html")
for path in html_files:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    original = content
    
    # Fix img tags without alt
    # Find all <img ...>
    imgs = re.findall(r'<img[^>]+>', content)
    for img in imgs:
        if 'alt=' not in img:
            new_img = img.replace('<img', '<img alt="Image"')
            content = content.replace(img, new_img)

    # Check for empty links or bad links, but mainly logo link
    # If the logo is <img src="/warehouse/assets/logo.png"> we want to ensure it is wrapped in <a href="/warehouse/">
    # Or just replace it directly if we see it:
    # Actually, a simple regex to replace <img> with alt="Kompaniya logotipi" if it contains logo
    content = re.sub(r'<img([^>]*src="[^"]*logo[^"]*"[^>]*)alt="Image"', r'<img\1alt="Kompaniya logotipi"', content)

    if original != content:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Updated alt tags in {path}")
