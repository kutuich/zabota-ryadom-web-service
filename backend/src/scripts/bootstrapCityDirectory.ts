import { prisma } from "../db/prisma";
import { CITY_DIRECTORY } from "../services/cityDirectory";

async function main() {
  for (const city of CITY_DIRECTORY) {
    await prisma.city.upsert({
      where: { slug: city.slug },
      update: {
        name: city.name,
        normalizedName: city.normalizedName,
        type: city.type,
        region: city.region,
        source: city.source,
        directoryStatus: city.directoryStatus,
        timezone: city.timezone,
        pricingZone: city.pricingZone,
        sortOrder: city.sortOrder,
        mapCenterLat: city.mapCenterLat,
        mapCenterLng: city.mapCenterLng
      },
      create: {
        ...city,
        status: "inactive",
        defaultCommissionAmount: 50,
        minTopUpAmount: 150,
        mapDefaultRadiusMeters: 600,
        districtsJson: "[]",
        localSettingsJson: "{}"
      }
    });
  }
}

main()
  .catch((error) => {
    console.error("Failed to bootstrap city directory", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
