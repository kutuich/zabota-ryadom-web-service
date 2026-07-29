import cors from "cors";
import express from "express";
import type { NextFunction, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { env } from "./config/env";
import { uploadsRoot } from "./services/uploadStorage";
import { adminRouter } from "./routes/admin";
import { authRouter } from "./routes/auth";
import { balanceRouter } from "./routes/balance";
import { chatsRouter } from "./routes/chats";
import { complaintsRouter } from "./routes/complaints";
import { pricingRouter } from "./routes/pricing";
import { performerDocumentsRouter } from "./routes/performerDocuments";
import { performerProfileRouter } from "./routes/performerProfile";
import { adminPaymentsRouter, paymentsRouter } from "./routes/payments";
import { knowledgeRouter } from "./routes/knowledge";
import { legalRouter } from "./routes/legal";
import { publicRouter } from "./routes/public";
import { requestsRouter } from "./routes/requests";
import { settlementsRouter } from "./routes/settlements";
import { meCitiesRouter } from "./routes/meCities";
import { managerRouter } from "./routes/manager";
import { npdRegisterRouter } from "./routes/npdRegister";
import {
  adminCategoryStructuresRouter,
  categoriesRouter,
  categoryStructuresRouter,
  helperCategoryPreferencesRouter
} from "./routes/categoryStructures";
import {
  adminBroadcastsRouter,
  adminServiceConversationsRouter,
  meServiceMessagesRouter,
  paymentServiceMessagesRouter,
  serviceMessageAttachmentsRouter
} from "./routes/serviceCommunications";
import { authenticate } from "./middleware/auth";
import { sendError } from "./utils/http";

export function createApp() {
  const app = express();
  const projectRoot = resolveProjectRoot();
  const frontendDistPath = path.join(projectRoot, "frontend/dist");
  const frontendAssetsPath = path.join(frontendDistPath, "assets");
  const frontendIndexPath = path.join(frontendDistPath, "index.html");
  const landingPublicPath = path.join(projectRoot, "landing-public");
  const landingCssPath = path.join(landingPublicPath, "css");
  const landingJsPath = path.join(landingPublicPath, "js");
  const landingAssetsPath = path.join(landingPublicPath, "assets");

  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use("/api/admin/service-conversations", authenticate, express.json({ limit: "70mb" }), adminServiceConversationsRouter);
  app.use(express.json({ limit: "8mb" }));
  app.use("/uploads/service-messages", (_req, res) => res.status(404).send("Not found"));
  app.use("/uploads", express.static(uploadsRoot));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "zabota-ryadom-web-service" });
  });

  app.use("/api/public", publicRouter);
  app.use("/api/settlements", settlementsRouter);
  app.use("/api/me/cities", meCitiesRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/requests", requestsRouter);
  app.use("/api/pricing", pricingRouter);
  app.use("/api/performer-documents", performerDocumentsRouter);
  app.use("/api/performer-profile", performerProfileRouter);
  app.use("/api/knowledge", knowledgeRouter);
  app.use("/api/legal", legalRouter);
  app.use("/api/chats", chatsRouter);
  app.use("/api/balance", balanceRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/complaints", complaintsRouter);
  app.use("/api/category-structures", categoryStructuresRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/helper/category-preferences", helperCategoryPreferencesRouter);
  app.use("/api/me/service-messages", meServiceMessagesRouter);
  app.use("/api/service-message-attachments", serviceMessageAttachmentsRouter);
  app.use("/api/manager", managerRouter);
  app.use("/api/admin/npd-register", npdRegisterRouter);
  app.use("/api/admin/payments", adminPaymentsRouter);
  app.use("/api/admin/payments", paymentServiceMessagesRouter);
  app.use("/api/admin/broadcasts", adminBroadcastsRouter);
  app.use("/api/admin/category-structures", adminCategoryStructuresRouter);
  app.use("/api/admin", adminRouter);

  if (env.nodeEnv === "production") {
    app.use("/app/assets", express.static(frontendAssetsPath, { index: false }));
    app.use("/app/assets", (_req, res) => res.status(404).send("Not found"));
    app.get(["/app", "/app/*", "/legal", "/legal/*"], (_req, res, next) => {
      sendFileWithinRoot(frontendDistPath, "index.html", res, next);
    });

    app.use("/css", express.static(landingCssPath, { index: false }));
    app.use("/css", (_req, res) => res.status(404).send("Not found"));
    app.use("/js", express.static(landingJsPath, { index: false }));
    app.use("/js", (_req, res) => res.status(404).send("Not found"));
    app.use("/assets", express.static(landingAssetsPath, { index: false }));
    app.use("/assets", (_req, res) => res.status(404).send("Not found"));

    app.get("/", (_req, res, next) => {
      sendFileWithinRoot(landingPublicPath, "index.html", res, next);
    });
    for (const htmlFile of landingHtmlFiles) {
      app.get(`/${htmlFile}`, (_req, res, next) => {
        sendFileWithinRoot(landingPublicPath, htmlFile, res, next);
      });
    }
    app.get(blockedLegacyStaticPaths, (_req, res) => res.status(404).send("Not found"));
    app.get("*.html", (_req, res) => res.status(404).send("Not found"));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      return sendFileWithinRoot(landingPublicPath, "index.html", res, next);
    });
  }

  app.use(sendError);

  return app;
}

const landingHtmlFiles = [
  "prices.html",
  "payment.html",
  "refund.html",
  "security.html",
  "contacts.html",
  "faq.html",
  "how-it-works.html",
  "legal.html"
];

const blockedLegacyStaticPaths = [
  "*.php",
  "/admin",
  "/admin/*",
  "/includes",
  "/includes/*",
  "/data",
  "/data/*"
];

function sendFileWithinRoot(root: string, relativeFilePath: string, res: Response, next: NextFunction) {
  const absoluteRoot = path.resolve(root);
  const absoluteFilePath = path.resolve(absoluteRoot, relativeFilePath);
  if (!isPathInsideRoot(absoluteRoot, absoluteFilePath) || !isExistingFile(absoluteFilePath)) {
    return res.status(404).send("Not found");
  }
  return res.sendFile(absoluteFilePath, (error) => {
    if (error) next(error);
  });
}

function isPathInsideRoot(root: string, target: string) {
  const relativePath = path.relative(root, target);
  return relativePath === "" || (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isExistingFile(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveProjectRoot() {
  const cwd = process.cwd();
  if (hasStaticRoots(cwd)) return cwd;
  const parent = path.resolve(cwd, "..");
  if (hasStaticRoots(parent)) return parent;
  return cwd;
}

function hasStaticRoots(candidateRoot: string) {
  return fs.existsSync(path.join(candidateRoot, "frontend")) || fs.existsSync(path.join(candidateRoot, "landing-public"));
}
