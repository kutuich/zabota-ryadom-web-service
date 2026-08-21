import { PrismaClient } from "@prisma/client";

const phoneService = await import("../backend/dist/src/services/phoneService.js");
const passwordService = await import("../backend/dist/src/services/passwordService.js");
const normalizeRussianPhone = phoneService.normalizeRussianPhone ?? phoneService.default?.normalizeRussianPhone;
const hashPassword = passwordService.hashPassword ?? passwordService.default?.hashPassword;

if (typeof normalizeRussianPhone !== "function" || typeof hashPassword !== "function") {
  throw new Error("Required authentication services are not available. Build the backend before bootstrap.");
}

const email = requiredEnv("PRODUCTION_ADMIN_EMAIL").trim().toLowerCase();
const password = requiredEnv("PRODUCTION_ADMIN_PASSWORD");
const phone = normalizeRussianPhone(requiredEnv("PRODUCTION_ADMIN_PHONE"));
const displayName = process.env.PRODUCTION_ADMIN_DISPLAY_NAME?.trim() || "Администратор";

const prisma = new PrismaClient();

try {
  const usersCount = await prisma.user.count();
  if (usersCount !== 0) {
    console.log(`Database already has ${usersCount} users. Production admin bootstrap skipped.`);
    process.exit(0);
  }

  const passwordHash = await hashPassword(password);
  const now = new Date();

  await prisma.user.create({
    data: {
      role: "superadmin",
      rolesJson: JSON.stringify(["superadmin"]),
      email,
      phone,
      normalizedPhone: phone,
      displayName,
      passwordHash,
      status: "active",
      isPhoneVerified: true,
      isEmailVerified: true,
      phoneVerifiedAt: now,
      emailVerifiedAt: now
    }
  });

  console.log(`Production administrator created: ${email}`);
} finally {
  await prisma.$disconnect();
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is required for production admin bootstrap.`);
  }
  return value;
}
