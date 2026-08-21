import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
import { writeAudit } from "../../../services/auditService";
import { HttpError } from "../../../utils/http";
import { linkUserCityTx } from "../../../services/settlementService";

const profileSchema = z.object({
  displayName: z.string().min(2).max(120).optional(),
  cityId: z.string().min(1).optional(),
  age: z.number().int().positive().max(100).optional().nullable(),
  experience: z.string().max(2000).optional(),
  services: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  districts: z.array(z.string()).default([]),
  canTravelIndependently: z.boolean().default(false),
  canTravelOutsideCity: z.boolean().default(false),
  readyForHygieneHelp: z.boolean().default(false),
  readyForPhysicalHelp: z.boolean().default(false),
  readyForLimitedMobility: z.boolean().default(false),
  readyForChildren: z.boolean().default(false),
  readyForUrgentRequests: z.boolean().default(false),
  readyToProvideDocuments: z.boolean().default(false),
  schedule: z.string().max(1000).optional(),
  selfEmployedStatus: z.string().optional(),
  criminalRecordCertificateStatus: z.string().optional(),
  profileComment: z.string().max(2000).optional()
});
@Controller("api/performer-profile")
export class PerformerProfileController {
  @Patch("/me")
  @RequireRoles("performer")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async patchme0(@Req() req: Request, @Res() res: Response) {
    const input = profileSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      if (input.displayName || input.cityId) {
        await tx.user.update({
          where: { id: req.user!.id },
          data: {
            displayName: input.displayName,
            cityId: input.cityId
          }
        });
        if (input.cityId) {
          await linkUserCityTx(tx, { userId: req.user!.id, cityId: input.cityId, roleScope: "helper", isPrimary: true });
        }
      }

      const profile = await tx.performerProfile.upsert({
        where: { userId: req.user!.id },
        update: {
          age: input.age,
          experience: input.experience,
          services: JSON.stringify(input.services),
          skills: JSON.stringify(input.skills),
          districts: JSON.stringify(input.districts),
          canTravelIndependently: input.canTravelIndependently,
          canTravelOutsideCity: input.canTravelOutsideCity,
          readyForHygieneHelp: input.readyForHygieneHelp,
          readyForPhysicalHelp: input.readyForPhysicalHelp,
          readyForLimitedMobility: input.readyForLimitedMobility,
          readyForChildren: input.readyForChildren,
          readyForUrgentRequests: input.readyForUrgentRequests,
          readyToProvideDocuments: input.readyToProvideDocuments,
          schedule: input.schedule,
          selfEmployedStatus: input.selfEmployedStatus,
          criminalRecordCertificateStatus: input.criminalRecordCertificateStatus,
          profileComment: input.profileComment,
          trustLevel: "profile_completed",
          verificationStatuses: JSON.stringify(["phone_verified", "profile_completed", "documents_optional"])
        },
        create: {
          userId: req.user!.id,
          age: input.age,
          experience: input.experience,
          services: JSON.stringify(input.services),
          skills: JSON.stringify(input.skills),
          districts: JSON.stringify(input.districts),
          canTravelIndependently: input.canTravelIndependently,
          canTravelOutsideCity: input.canTravelOutsideCity,
          readyForHygieneHelp: input.readyForHygieneHelp,
          readyForPhysicalHelp: input.readyForPhysicalHelp,
          readyForLimitedMobility: input.readyForLimitedMobility,
          readyForChildren: input.readyForChildren,
          readyForUrgentRequests: input.readyForUrgentRequests,
          readyToProvideDocuments: input.readyToProvideDocuments,
          schedule: input.schedule,
          selfEmployedStatus: input.selfEmployedStatus ?? "self_employed_not_provided",
          criminalRecordCertificateStatus: input.criminalRecordCertificateStatus ?? "criminal_record_not_provided",
          profileComment: input.profileComment,
          trustLevel: "profile_completed",
          verificationStatuses: JSON.stringify(["phone_verified", "profile_completed", "documents_optional"])
        }
      });

      await writeAudit(req.user!.id, "performer.profile_update", "user", req.user!.id, input, tx);
      return profile;
    });

    res.json(result);
  }
}
