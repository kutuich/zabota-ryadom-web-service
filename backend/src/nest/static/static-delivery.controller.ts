import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../config/env";

const landingHtmlFiles = new Set([
  "prices.html", "payment.html", "refund.html", "security.html", "contacts.html",
  "faq.html", "how-it-works.html", "legal.html"
]);

@Controller()
export class StaticDeliveryController {
  private readonly projectRoot = resolveProjectRoot();
  private readonly frontendDistPath = path.join(this.projectRoot, "frontend/dist");
  private readonly landingPublicPath = path.join(this.projectRoot, "landing-public");

  @Get("uploads/*path")
  denyUploads(@Res() response: Response) {
    response.status(404).send("Not found");
  }

  @Get("app/assets/*path")
  appAsset(@Req() request: Request, @Res() response: Response) {
    return this.sendStaticFile(path.join(this.frontendDistPath, "assets"), stripPrefix(request.path, "/app/assets/"), response);
  }

  @Get("css/*path")
  landingCss(@Req() request: Request, @Res() response: Response) {
    return this.sendStaticFile(path.join(this.landingPublicPath, "css"), stripPrefix(request.path, "/css/"), response);
  }

  @Get("js/*path")
  landingJs(@Req() request: Request, @Res() response: Response) {
    return this.sendStaticFile(path.join(this.landingPublicPath, "js"), stripPrefix(request.path, "/js/"), response);
  }

  @Get("assets/*path")
  landingAsset(@Req() request: Request, @Res() response: Response) {
    return this.sendStaticFile(path.join(this.landingPublicPath, "assets"), stripPrefix(request.path, "/assets/"), response);
  }

  @Get(["app", "app/*path", "legal", "legal/*path"])
  application(@Res() response: Response) {
    return this.sendProductionFile(this.frontendDistPath, "index.html", response);
  }

  @Get("")
  landing(@Res() response: Response) {
    return this.sendProductionFile(this.landingPublicPath, "index.html", response);
  }

  @Get("*path")
  fallback(@Req() request: Request, @Res() response: Response) {
    if (env.nodeEnv !== "production") return response.status(404).send("Not found");
    const relativePath = request.path.replace(/^\/+/, "");
    if (landingHtmlFiles.has(relativePath)) return this.sendFile(this.landingPublicPath, relativePath, response);
    if (
      request.path.startsWith("/api") || request.path.startsWith("/admin")
      || request.path.startsWith("/includes") || request.path.startsWith("/data")
      || relativePath.endsWith(".php") || relativePath.endsWith(".html")
    ) return response.status(404).send("Not found");
    return this.sendFile(this.landingPublicPath, "index.html", response);
  }

  private sendProductionFile(root: string, relativePath: string, response: Response) {
    if (env.nodeEnv !== "production") return response.status(404).send("Not found");
    return this.sendFile(root, relativePath, response);
  }

  private sendStaticFile(root: string, relativePath: string, response: Response) {
    if (env.nodeEnv !== "production") return response.status(404).send("Not found");
    return this.sendFile(root, relativePath, response);
  }

  private sendFile(root: string, relativePath: string, response: Response) {
    const absoluteRoot = path.resolve(root);
    const absoluteFilePath = path.resolve(absoluteRoot, relativePath);
    if (!isPathInsideRoot(absoluteRoot, absoluteFilePath) || !isExistingFile(absoluteFilePath)) {
      return response.status(404).send("Not found");
    }
    return response.sendFile(absoluteFilePath);
  }
}

function stripPrefix(requestPath: string, prefix: string) {
  return decodeURIComponent(requestPath.startsWith(prefix) ? requestPath.slice(prefix.length) : "");
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
  return hasStaticRoots(parent) ? parent : cwd;
}

function hasStaticRoots(candidateRoot: string) {
  return fs.existsSync(path.join(candidateRoot, "frontend")) || fs.existsSync(path.join(candidateRoot, "landing-public"));
}
