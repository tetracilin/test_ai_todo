import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { developmentCommentIntakeListQuerySchema } from "@paperclipai/shared";
import { ZodError } from "zod";
import { badRequest } from "../errors.js";
import { developmentCommentIntakeService } from "../services/development-comment-intakes.js";
import { assertAuthenticated, assertCompanyAccess } from "./authz.js";

/**
 * Read-only agent query surface for `development_comment_intakes`
 * (design doc/plans/2026-08-30-dev-comment-intake-design.md §7).
 *
 *   GET /companies/:companyId/development-comment-intakes
 *   GET /companies/:companyId/development-comment-intakes/:intakeId
 *
 * Authorization follows the design contract:
 *   - 401 unauthenticated;
 *   - agent API key/JWT must belong to `companyId` — cross-company request is
 *     403 before any query runs;
 *   - board caller requires existing company access (403 for the scoped list);
 *   - the detail endpoint returns an indistinguishable 404 for both missing
 *     and cross-company intake ids (no existence oracle).
 *
 * There are deliberately no agent write, source configuration, checkpoint,
 * retry, or backlog-create endpoints here — those are board/admin or
 * server-worker paths only.
 */

function formatQueryError(error: ZodError): string {
  const first = error.issues[0];
  const location = first?.path?.join(".") ?? "query";
  return `Invalid development comment intake filter: ${location} ${first?.message ?? "is invalid"}`.trim();
}

export function developmentCommentIntakeRoutes(db: Db) {
  const router = Router();
  const service = developmentCommentIntakeService(db);

  router.get("/companies/:companyId/development-comment-intakes", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = developmentCommentIntakeListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest(formatQueryError(parsed.error));
    }

    const feed = await service.list(companyId, parsed.data);
    res.json(feed);
  });

  router.get("/companies/:companyId/development-comment-intakes/:intakeId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const intakeId = req.params.intakeId as string;
    assertAuthenticated(req);

    const item = await service.getById(companyId, intakeId);
    if (!item) {
      res.status(404).json({ error: "Development comment intake not found" });
      return;
    }
    res.json(item);
  });

  return router;
}