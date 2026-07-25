AKBEL deploy quick notes
========================

Domain:
  akbelim.com

Recommended platform:
  Northflank

Required runtime:
  Node.js 18+

Start command:
  npm start

Health check:
  /healthz

Persistent data:
  Use a mounted volume and point state file there:

  WAREHOUSE_STATE_FILE=/data/warehouse.json

This automatically stores uploaded transaction photos in:

  /data/transaction-photos

Suggested environment variables:
  PORT=3000
  WAREHOUSE_COMPANY_NAME=Сыр АКБЕЛ
  WAREHOUSE_ADMIN_USERNAME=...
  WAREHOUSE_ADMIN_PASSWORD=...
  WAREHOUSE_STATE_FILE=/data/warehouse.json
  WAREHOUSE_ALLOWED_ORIGIN=https://akbelim.com
  WAREHOUSE_MAX_REQUEST_BYTES=6291456
  TELEGRAM_BOT_TOKEN=

Before first push:
  1) Set real git user.name
  2) Set real git user.email
  3) Create GitHub repo and add remote origin
  4) git add .
  5) git commit -m "Initial AKBEL deploy"
  6) git push -u origin main

---

BITTA SERVER BILAN ISHLATISH (Docker Compose)
=============================================

1. .env.example faylini nusxa oling:
     cp .env.example .env

2. .env faylida sozlamalarni to'ldiring (parol, token va h.k.)

3. Konteyner ishga tushiring:
     docker compose up -d

4. Loglarni kuring:
     docker compose logs -f

Ma'lumotlar "akbel-data" nomli Docker volume ichida saqlanadi va
konteyner qayta ishga tushirilganda yo'qolmaydi.

---

IKKALA SERVER BILAN ISHLATISH
==============================

Tayyorgarlik:

  a) Birinchi serverda NFS o'rnating (ma'lumotlar shu serverda saqlanadi):

     apt install nfs-kernel-server
     mkdir -p /srv/akbel-data/transaction-photos
     echo '/srv/akbel-data  <SERVER2_IP>(rw,sync,no_subtree_check)' >> /etc/exports
     exportfs -a

  b) Ikkala serverda .env faylida sozlamalar:

     WAREHOUSE_STATE_FILE=/data/warehouse.json
     WAREHOUSE_ALLOWED_ORIGIN=https://akbelim.com,https://server2.akbelim.com
     NFS_SERVER_IP=<birinchi server IP manzili>

  c) Ikkala serverda ilovani ishga tushiring:

     docker compose -f docker-compose.multi.yml up -d

  d) Nginx load balancer sozlash (ixtiyoriy — foydalanuvchilarni ikkala
     server orasida taqsimlash uchun):

     apt install nginx
     cp nginx/nginx.conf /etc/nginx/sites-available/akbel
     # nginx.conf ichidagi SERVER1_IP va SERVER2_IP ni almashtiring
     ln -s /etc/nginx/sites-available/akbel /etc/nginx/sites-enabled/akbel
     nginx -t && systemctl reload nginx

Natija: Ikkala server bir xil /data papkasini (NFS orqali) ko'radi,
shuning uchun warehouse.json va fotosuratlar har doim muvofiq bo'ladi.

---

NORTHFLANK (bulut platformasi)
===============================

1. Northflank da yangi Service yarating
2. Add-on → Volume qo'shing, Mount path: /data
3. Muhit o'zgaruvchilarini sozlang (yuqoridagi ro'yxatdan)
4. Ikkala instance uchun WAREHOUSE_ALLOWED_ORIGIN ga ikkala URL ni
   vergul bilan yozing:
     WAREHOUSE_ALLOWED_ORIGIN=https://akbelim.com,https://server2.akbelim.com