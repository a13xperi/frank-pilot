/**
 * frank-contact /api/frank/vcard — public vCard download.
 *
 * Asserts the endpoint serves a valid, downloadable vCard 3.0 (200, the
 * registered text/vcard media type, attachment disposition) carrying the
 * Donna Louise assistant phone number — so a tenant can one-tap "Add to
 * Contacts" and then call or text Frank. No auth, no input, no backend.
 */
import express from "express";
import request from "supertest";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

import { frankContactRoutes } from "../modules/frank-contact";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/frank", frankContactRoutes);
  return app;
}

describe("GET /api/frank/vcard — public vCard", () => {
  let app: express.Express;

  beforeAll(() => {
    app = buildApp();
  });

  it("returns HTTP 200", async () => {
    const res = await request(app).get("/api/frank/vcard");
    expect(res.status).toBe(200);
  });

  it("serves the text/vcard content type", async () => {
    const res = await request(app).get("/api/frank/vcard");
    expect(res.headers["content-type"]).toContain("text/vcard");
  });

  it("forces a download with a stable filename", async () => {
    const res = await request(app).get("/api/frank/vcard");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain('filename="frank.vcf"');
  });

  it("returns a valid vCard body with the assistant phone number", async () => {
    const res = await request(app).get("/api/frank/vcard");
    expect(res.text).toContain("BEGIN:VCARD");
    expect(res.text).toContain("END:VCARD");
    expect(res.text).toContain("VERSION:3.0");
    expect(res.text).toContain("+17252672488");
  });
});
