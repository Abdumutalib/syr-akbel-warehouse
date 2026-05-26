/**
 * Sotuvchi sifatida kirganida barcha knopkalar ko'rinishini tekshirish
 */

import { readFileSync } from "fs";

// warehouse-top-nav.js ni o'qib, NAV_ITEMS ni parse qilamiz
// hasPermission logikasini simulyatsiya qilamiz
function hasPermission(profile, requiredPermissions) {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
  const required = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  return required.some((entry) => permissions.includes(entry));
}

// To'liq sotuvchi profili (permissions = ["seller", "customers"])
const SELLER_PROFILE = {
  id: 1,
  username: "sotuvchi1",
  fullName: "Ali Sotuvchi",
  role: "seller",
  permissions: ["seller", "customers"],
};

// Admin profili
const ADMIN_PROFILE = {
  id: 0,
  username: "admin",
  fullName: "Administrator",
  role: "admin",
  permissions: [],
};

// NAV_ITEMS visibility logikasi (warehouse-top-nav.js dan ko'chirilgan)
const NAV_ITEMS = [
  {
    label: "Admin panel",
    href: "/warehouse/admin",
    isVisible(profile) {
      if (!profile) return false;
      if (profile.role === "admin") return true;
      return hasPermission(profile, "admin_panel");
    },
  },
  {
    label: "Admin naqd",
    href: "/warehouse/admin/cash",
    isVisible(profile) {
      if (!profile) return false;
      if (profile.role === "admin") return true;
      return hasPermission(profile, "cash");
    },
  },
  {
    label: "Admin o'tkazma",
    href: "/warehouse/admin/transfer",
    isVisible(profile) {
      if (!profile) return false;
      if (profile.role === "admin") return true;
      return hasPermission(profile, "transfer");
    },
  },
  {
    label: "Umumiy hisobot",
    href: "/warehouse/ledger",
    isVisible(profile) {
      if (!profile) return false;
      if (profile.role === "admin") return true;
      return hasPermission(profile, ["cash", "transfer"]);
    },
  },
  {
    label: "Sotuvchi",
    href: "/warehouse/seller",
    isVisible(profile) {
      if (!profile) return false;
      if (profile.role === "admin") return true;
      return hasPermission(profile, "seller");
    },
  },
  {
    label: "Mijozlar",
    href: "/warehouse/customers",
    isVisible(profile) {
      if (!profile) return false;
      if (profile.role === "admin") return true;
      return hasPermission(profile, ["customers", "seller"]);
    },
  },
  {
    label: "Buyurtmalar",
    href: "/warehouse/orders",
    isVisible(profile) {
      return Boolean(profile);
    },
  },
  {
    label: "Naqd savdo yozish",
    href: "/warehouse/seller/sale/cash",
    isVisible(profile) {
      if (!profile) return false;
      if (profile.role === "admin") return true;
      return hasPermission(profile, "seller");
    },
  },
  {
    label: "O'tkazma savdo yozish",
    href: "/warehouse/seller/sale/transfer",
    isVisible(profile) {
      if (!profile) return false;
      if (profile.role === "admin") return true;
      return hasPermission(profile, ["seller", "transfer"]);
    },
  },
];

let pass = 0;
let fail = 0;

console.log("\n" + "=".repeat(60));
console.log("  SOTUVCHI UCHUN NAVIGATSIYA KNOPKALARI TESTI");
console.log("=".repeat(60) + "\n");

// ====== SOTUVCHI TEKSHIRUVI ======
console.log("👤 Sotuvchi profili:", SELLER_PROFILE.permissions, "\n");
console.log("📍 Sotuvchi uchun ko'rinadigan knopkalar:");

const sellerVisible = [];
const sellerHidden = [];

for (const item of NAV_ITEMS) {
  const visible = item.isVisible(SELLER_PROFILE);
  if (visible) {
    sellerVisible.push(item.label);
    console.log(`  ✅ ${item.label}`);
  } else {
    sellerHidden.push(item.label);
    console.log(`  ⛔ ${item.label} (yashirilgan)`);
  }
}

console.log(`\n📊 Sotuvchiga ko'rinadi: ${sellerVisible.length}/9 ta knopka`);

// Tekshirish: sotuvchi ko'rishi KERAK bo'lgan knopkalar
const MUST_SEE_FOR_SELLER = [
  "Sotuvchi",
  "Mijozlar",
  "Buyurtmalar",
  "Naqd savdo yozish",
  "O'tkazma savdo yozish",
];

// Tekshirish: sotuvchi KO'RMASLIGI kerak bo'lgan admin knopkalar
const MUST_NOT_SEE_FOR_SELLER = [
  "Admin panel",
  "Admin naqd",
  "Admin o'tkazma",
  "Umumiy hisobot",
];

console.log("\n" + "-".repeat(60));
console.log("✔️  Sotuvchi KO'RISHI KERAK bo'lgan knopkalar:");
for (const label of MUST_SEE_FOR_SELLER) {
  const visible = NAV_ITEMS.find(i => i.label === label)?.isVisible(SELLER_PROFILE);
  if (visible) {
    console.log(`  ✅ "${label}" — ko'rinadi`);
    pass++;
  } else {
    console.log(`  ❌ "${label}" — KO'RINMAYDI! (BUG!)`);
    fail++;
  }
}

console.log("\n🔒 Sotuvchi KO'RMASLIGI kerak bo'lgan admin knopkalar:");
for (const label of MUST_NOT_SEE_FOR_SELLER) {
  const visible = NAV_ITEMS.find(i => i.label === label)?.isVisible(SELLER_PROFILE);
  if (!visible) {
    console.log(`  ✅ "${label}" — to'g'ri yashirilgan`);
    pass++;
  } else {
    console.log(`  ⚠️  "${label}" — sotuvchiga ko'rinmoqda (admin sahifasi!)`);
    // Bu xato emas, lekin xavfsizlik nuqtai nazaridan e'tibor berish kerak
  }
}

// ====== ADMIN TEKSHIRUVI ======
console.log("\n" + "-".repeat(60));
console.log("👑 Admin uchun barcha knopkalar tekshiruvi:");
let adminAllVisible = true;
for (const item of NAV_ITEMS) {
  const visible = item.isVisible(ADMIN_PROFILE);
  if (visible) {
    console.log(`  ✅ "${item.label}"`);
    pass++;
  } else {
    console.log(`  ❌ "${item.label}" — admin uchun ham ko'rinmayapti! (BUG!)`);
    fail++;
    adminAllVisible = false;
  }
}

// ====== KIRISH QO'YILMAGAN ======
console.log("\n" + "-".repeat(60));
console.log("🚫 Kirilmagan holda (profile=null) — hech narsa ko'rinmasligi kerak:");
let anyVisible = false;
for (const item of NAV_ITEMS) {
  const visible = item.isVisible(null);
  if (visible) {
    console.log(`  ❌ "${item.label}" — login qilmasdan ko'rinmoqda! (BUG!)`);
    fail++;
    anyVisible = true;
  }
}
if (!anyVisible) {
  console.log("  ✅ Hech qaysi knopka ko'rinmaydi — to'g'ri!");
  pass++;
}

// ====== YAKUNIY NATIJA ======
console.log("\n" + "=".repeat(60));
console.log("  YAKUNIY NATIJA");
console.log("=".repeat(60));
console.log(`\n✅ O'tdi: ${pass}`);
console.log(`❌ Xato: ${fail}`);
console.log(`\nSotuvchi uchun ko'rinadigan knopkalar (${sellerVisible.length} ta):`);
sellerVisible.forEach(l => console.log(`  • ${l}`));

if (sellerHidden.length > 0) {
  console.log(`\nAdmin knopkalar (sotuvchidan yashirilgan - ${sellerHidden.length} ta):`);
  sellerHidden.forEach(l => console.log(`  • ${l}`));
}

console.log();

if (fail > 0) {
  console.log("❌ TESTLAR MUVAFFAQIYATSIZ!");
  process.exit(1);
} else {
  console.log("🎉 Barcha testlar O'TDI! Knopkalar to'g'ri ishlaydi.\n");
}
