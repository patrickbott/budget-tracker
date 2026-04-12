/**
 * `list_categories` — directory lookup so the model can resolve
 * natural-language category names to UUIDs before calling other tools.
 *
 * Returns every category for the family, including parent name for
 * hierarchical categories. Minimal PII risk but stripped for
 * consistency with all other tool adapters.
 */

import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

export const listCategoriesArgs = z
  .object({})
  .describe('No arguments — returns all categories for the family.');

export const listCategoriesOutput = z.object({
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      parent_name: z.string().nullable(),
    }),
  ),
});

export type ListCategoriesArgs = z.infer<typeof listCategoriesArgs>;
export type ListCategoriesOutput = z.infer<typeof listCategoriesOutput>;

export const listCategoriesTool: ToolAdapter<
  ListCategoriesArgs,
  ListCategoriesOutput
> = async (_args, loaders) => {
  listCategoriesArgs.parse(_args);

  const rows = await loaders.loadCategories();

  const mapped = {
    categories: rows.map((row) => ({
      id: row.id,
      name: row.name,
      parent_name: row.parentName,
    })),
  };

  return listCategoriesOutput.parse(stripPII(mapped));
};
