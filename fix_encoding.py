import subprocess

# Get the clean pre-corruption version from git
good_admin = subprocess.run(['git', 'show', 'c807b7c:public/warehouse-admin.html'], capture_output=True)
raw_admin = good_admin.stdout

good_dash = subprocess.run(['git', 'show', 'c807b7c:public/warehouse-dashboard.html'], capture_output=True)
raw_dash = good_dash.stdout

# Inject warehouse-top-nav.js before </body>
top_nav = b'  <script src="/warehouse-top-nav.js"></script>\n'

fixed_admin = raw_admin.replace(b'</body>', top_nav + b'</body>')
fixed_dash = raw_dash.replace(b'</body>', top_nav + b'</body>')

# Write as raw bytes to preserve original UTF-8
with open('public/warehouse-admin.html', 'wb') as f:
    f.write(fixed_admin)
print('Admin written, size:', len(fixed_admin))

with open('public/warehouse-dashboard.html', 'wb') as f:
    f.write(fixed_dash)
print('Dashboard written, size:', len(fixed_dash))

# Verify encoding is correct
with open('public/warehouse-admin.html', 'rb') as f:
    check = f.read()
t1 = check.find(b'<title>') + 7
t2 = check.find(b'</title>')
title = check[t1:t2].decode('utf-8')
print('Admin title (UTF-8):', title)
print('Has top-nav:', b'warehouse-top-nav.js' in check)
