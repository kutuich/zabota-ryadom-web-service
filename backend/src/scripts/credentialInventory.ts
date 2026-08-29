import { prisma } from "../db/prisma";
import { isArgon2idHash } from "../services/passwordService";

async function main() {
  try {
    const credentials = await prisma.user.findMany({
      where: { passwordHash: { not: null } },
      select: { passwordHash: true }
    });
    const argon2id = credentials.filter((credential) => isArgon2idHash(credential.passwordHash)).length;
    const unsupported = credentials.length - argon2id;
    console.log(JSON.stringify({ passwordCredentials: credentials.length, argon2id, unsupported }, null, 2));
    if (unsupported > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
