import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = parseInt(process.env.ENCRYPTION_IV_LENGTH || "16");
const KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, "hex")
  : crypto.randomBytes(32);

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function hashSSN(ssn: string): string {
  return crypto.createHash("sha256").update(ssn).digest("hex");
}

export function maskSSN(ssn: string): string {
  const clean = ssn.replace(/\D/g, "");
  if (clean.length !== 9) return "***-**-****";
  return `***-**-${clean.slice(5)}`;
}

export function maskCardNumber(cardNumber: string): string {
  const clean = cardNumber.replace(/\D/g, "");
  if (clean.length < 4) return "****";
  return `****-****-****-${clean.slice(-4)}`;
}
