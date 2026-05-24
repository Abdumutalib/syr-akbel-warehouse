import re
import glob
import os

def check_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find all ids in HTML: id="someId" or id='someId'
    html_ids = set(re.findall(r'id=["\']([a-zA-Z0-9_-]+)["\']', content))
    
    # Find all getElementById in JS: getElementById('someId') or getElementById("someId")
    js_ids = set(re.findall(r'getElementById\([\'"]([a-zA-Z0-9_-]+)[\'"]\)', content))
    
    missing_in_html = js_ids - html_ids
    
    # Exclude ids that might be injected dynamically or belong to standard layout
    missing_filtered = [i for i in missing_in_html if i not in ('leaflet-css', 'locationMapModal', 'closeLocationMapModal', 'confirmLocationMap', 'findMyLocationBtn', 'locationMapContainer')]
    
    if missing_filtered:
        print(f"\\n--- {os.path.basename(filepath)} ---")
        print("JS expects these IDs, but they are NOT in the HTML:")
        for missing in missing_filtered:
            print(f"  - {missing}")

for file in glob.glob('public/*.html'):
    check_file(file)
