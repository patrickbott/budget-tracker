/**
 * Chat tables: `chat_conversation` and `chat_message`.
 *
 * Chat is PER-USER (not per-family) — a user can ask private questions
 * about the family's finances without showing those questions to other
 * family members. The `family_id` is still present for RLS scoping, so the
 * user can only see conversations that belong to a family they're a member
 * of. The `user_id` restricts reads further to the conversation owner.
 *
 * `role` mirrors Anthropic's message-role convention: 'user' | 'assistant',
 * plus a 'tool' pseudo-role for tool_use / tool_result display in the UI.
 * The actual tool_use blocks are stored as JSON in `tool_calls_json`.
 */
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { chatRoleEnum } from './enums.ts';
import { family } from './family.ts';
import { user } from './auth.ts';

export const chatConversation = pgTable(
  'chat_conversation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    /** Short human-readable title. Generated from the first user message
     *  by a Haiku call, or left NULL for the user to fill in. */
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('chat_conversation_user_idx').on(table.userId, table.updatedAt),
    index('chat_conversation_family_idx').on(table.familyId),
  ],
);

export const chatMessage = pgTable(
  'chat_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => chatConversation.id, { onDelete: 'cascade' }),
    /** Denormalized for RLS policies — RLS is keyed on family_id and
     *  chat_message is high-cardinality, so we avoid a JOIN to the
     *  conversation table on every read. */
    familyId: text('family_id')
      .notNull()
      .references(() => family.id, { onDelete: 'cascade' }),
    role: chatRoleEnum('role').notNull(),
    /** The text content of the message. For tool messages, this is a
     *  human-readable summary; the structured data lives in
     *  `tool_calls_json`. */
    content: text('content').notNull(),
    /** Anthropic tool_use / tool_result blocks, if any. Structure matches
     *  the Anthropic messages API response format. */
    toolCallsJson: jsonb('tool_calls_json').$type<Array<Record<string, unknown>>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('chat_message_conversation_idx').on(
      table.conversationId,
      table.createdAt,
    ),
    index('chat_message_family_idx').on(table.familyId),
  ],
);

export type ChatConversation = typeof chatConversation.$inferSelect;
export type NewChatConversation = typeof chatConversation.$inferInsert;
export type ChatMessage = typeof chatMessage.$inferSelect;
export type NewChatMessage = typeof chatMessage.$inferInsert;
