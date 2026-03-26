import winston from "winston";
import { filterPII } from "./pii-filter";

const piiFilterFormat = winston.format((info) => {
  if (typeof info.message === "string") {
    info.message = filterPII(info.message);
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    piiFilterFormat(),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "frank-pilot" },
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        piiFilterFormat(),
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}
