import { fileURLToPath } from "node:url";

/** Absolute path of a file in data/. fileURLToPath decodes %-escapes (spaces, accents)
 *  and Windows drive letters, which URL.pathname leaves encoded. */
export const dataPath = (name: string, base: string = import.meta.url): string =>
  fileURLToPath(new URL(`../data/${name}`, base));
