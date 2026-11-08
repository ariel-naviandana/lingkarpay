import "dotenv/config";
import { parseConfig, type Config } from "./config.schema.js";

export type { Config };

export const config: Config = parseConfig(process.env);

/** Kunci untuk memverifikasi signature_key: Signature Secret Key bila diisi, jika tidak Server Key. */
export const SIGNATURE_KEY: string = config.MIDTRANS_SIGNATURE_KEY ?? config.MIDTRANS_SERVER_KEY;
