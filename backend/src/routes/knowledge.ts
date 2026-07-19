import { Router } from "express";
import { prisma } from "../db/prisma";
import { asyncHandler } from "../utils/http";

export const knowledgeRouter = Router();

knowledgeRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const audience = String(req.query.audience ?? "all");
    res.json(
      await prisma.knowledgeArticle.findMany({
        where: {
          isPublished: true,
          OR: [{ audience: "all" }, { audience }]
        },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }]
      })
    );
  })
);
