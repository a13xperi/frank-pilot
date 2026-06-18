import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { logger } from "../../utils/logger";
import { routeInboundContact, type ContactChannel } from "./service";
import { upsertMapping, deactivateMapping, listMappings } from "./mapping";

/**
 * Multi-property router admin + resolve surface (Frank core C4).
 *
 * Mount path: /api/property-routing
 *   POST /resolve                     route an inbound contact → handling agent
 *   GET  /property/:propertyId        list a property's mappings
 *   POST /property/:propertyId        upsert a property→agent mapping
 *   DELETE /:mappingId                soft-disable a mapping
 *
 * Resolve is a manager-view operation (it reads the map); mutating the map is
 * asset-manager+ (property_routing:manage). NONE of this touches live DID/IVR
 * config — it only reads/writes the lookup table.
 */

const router = Router();

const VALID_CHANNELS = new Set<ContactChannel>(["voice", "sms", "web"]);

router.post(
  "/resolve",
  authenticate,
  requirePermission("property_routing:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const channelRaw = req.body?.channel;
    const channel = VALID_CHANNELS.has(channelRaw) ? (channelRaw as ContactChannel) : undefined;
    try {
      const decision = await routeInboundContact({
        propertyId: typeof req.body?.propertyId === "string" ? req.body.propertyId : null,
        toDid: typeof req.body?.toDid === "string" ? req.body.toDid : null,
        channel,
      });
      res.json(decision);
    } catch (err) {
      logger.error("Route resolve failed", { error: (err as Error).message });
      res.status(500).json({ error: "Resolve failed" });
    }
  }
);

router.get(
  "/property/:propertyId",
  authenticate,
  requirePermission("property_routing:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const rows = await listMappings(String(req.params.propertyId));
      res.json({ mappings: rows });
    } catch (err) {
      logger.error("List mappings failed", { error: (err as Error).message });
      res.status(500).json({ error: "List failed" });
    }
  }
);

router.post(
  "/property/:propertyId",
  authenticate,
  requirePermission("property_routing:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const agentId = String(req.body?.agentId ?? "").trim();
    if (!agentId) {
      res.status(400).json({ error: "agentId required" });
      return;
    }
    try {
      const row = await upsertMapping({
        propertyId: String(req.params.propertyId),
        agentId,
        agentLabel: typeof req.body?.agentLabel === "string" ? req.body.agentLabel : null,
        inboundDid: typeof req.body?.inboundDid === "string" ? req.body.inboundDid : null,
        channels: Array.isArray(req.body?.channels) ? req.body.channels.map(String) : [],
        priority: typeof req.body?.priority === "number" ? req.body.priority : undefined,
        active: typeof req.body?.active === "boolean" ? req.body.active : undefined,
      });
      res.status(201).json(row);
    } catch (err) {
      logger.error("Upsert mapping failed", { error: (err as Error).message });
      res.status(500).json({ error: "Upsert failed" });
    }
  }
);

router.delete(
  "/:mappingId",
  authenticate,
  requirePermission("property_routing:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const changed = await deactivateMapping(String(req.params.mappingId));
      if (!changed) {
        res.status(404).json({ error: "Mapping not found or already inactive" });
        return;
      }
      res.json({ deactivated: true });
    } catch (err) {
      logger.error("Deactivate mapping failed", { error: (err as Error).message });
      res.status(500).json({ error: "Deactivate failed" });
    }
  }
);

export default router;
