import { z } from "zod";

export const patchItemSchema = z
  .object({
    title: z.string().min(1),
    year: z.number().int().nullable(),
    venue: z.string().nullable(),
    abstract: z.string().nullable(),
    reading_status: z.enum(["unread", "reading", "read"]),
    starred: z.union([z.literal(0), z.literal(1)]),
  })
  .strict()
  .partial();

export type PatchItemInput = z.infer<typeof patchItemSchema>;
