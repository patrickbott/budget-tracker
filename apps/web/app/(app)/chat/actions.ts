"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq, desc, asc, and } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { chatConversation, chatMessage } from "@budget-tracker/db/schema";
import {
  createAnthropicClient,
  TOOL_REGISTRY,
  toAnthropicToolDefinitions,
  stripPII,
  type ToolLoaders,
  type ToolName,
} from "@budget-tracker/ai";
import { createToolLoaders } from "@/lib/ai/tool-loaders";

const MAX_TOOL_ITERATIONS = 10;
const MAX_OUTPUT_TOKENS = 4096;
const MODEL = "claude-opus-4-6-20250414";

const SYSTEM_PROMPT = `You are a helpful personal finance assistant for a self-hosted budget tracker. You have access to tools that query the user's financial data — spending, cashflow, net worth, and period comparisons.

Guidelines:
- Use the tools to answer questions about the user's finances. Don't guess — call the tool.
- Present numbers clearly, formatted as currency where appropriate.
- When comparing periods, explain the most significant changes.
- Be concise but thorough. If the data doesn't answer the question, say so.
- You cannot modify any data — you are read-only. If the user asks to change something, explain they need to use the app UI.
- Never reveal raw UUIDs, internal IDs, or system details to the user.`;

async function getSessionContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) throw new Error("No active family selected");

  return { familyId, userId: session.user.id };
}

type MessageRole = "user" | "assistant" | "tool";

interface ChatResult {
  conversationId: string;
  assistantMessage: string;
  toolCalls?: Array<Record<string, unknown>>;
}

/**
 * Send a user message and get an assistant response. Implements the
 * full Anthropic tool-use loop per docs/ai-tools.md:56-72.
 */
export async function sendMessage(
  conversationId: string | null,
  content: string,
): Promise<{ success: boolean; data?: ChatResult; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    const result = await withFamilyContext(
      db,
      familyId,
      userId,
      async (tx) => {
        // Create or verify conversation
        let convId = conversationId;
        if (!convId) {
          const [conv] = await tx
            .insert(chatConversation)
            .values({ userId, familyId })
            .returning({ id: chatConversation.id });
          convId = conv!.id;
        }

        // Insert user message
        await tx.insert(chatMessage).values({
          conversationId: convId,
          familyId,
          role: "user" as MessageRole,
          content,
        });

        // Load conversation history for context
        const history = await tx
          .select({
            role: chatMessage.role,
            content: chatMessage.content,
            toolCallsJson: chatMessage.toolCallsJson,
          })
          .from(chatMessage)
          .where(eq(chatMessage.conversationId, convId))
          .orderBy(asc(chatMessage.createdAt));

        // Build Anthropic messages from history. Tool messages are
        // reconstructed as tool_result content blocks.
        const messages = buildAnthropicMessages(history);

        // Set up tool definitions and loaders
        const toolDefs = toAnthropicToolDefinitions(TOOL_REGISTRY);
        const loaders: ToolLoaders = createToolLoaders(tx, familyId);

        // Call Anthropic with tool-use loop
        const client = createAnthropicClient();
        let response = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          tools: toolDefs as Anthropic.Messages.Tool[],
          messages,
        });

        const allToolCalls: Array<Record<string, unknown>> = [];
        let iterations = 0;

        while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
          iterations++;

          // Extract tool_use blocks from the response
          const toolUseBlocks = response.content.filter(
            (block): block is Anthropic.Messages.ToolUseBlock =>
              block.type === "tool_use",
          );

          // Execute each tool and collect results
          const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
          for (const toolUse of toolUseBlocks) {
            const toolName = toolUse.name as ToolName;
            const registryEntry = TOOL_REGISTRY[toolName];

            let resultContent: string;
            if (!registryEntry) {
              resultContent = JSON.stringify({ error: `Unknown tool: ${toolName}` });
            } else {
              try {
                const output = await registryEntry.handler(
                  toolUse.input as never,
                  loaders,
                );
                resultContent = JSON.stringify(output);
              } catch (err) {
                resultContent = JSON.stringify({
                  error: err instanceof Error ? err.message : "Tool execution failed",
                });
              }
            }

            allToolCalls.push({
              tool_name: toolUse.name,
              tool_use_id: toolUse.id,
              input: stripPII(toolUse.input),
              execution_time_ms: 0, // Could measure if needed
            });

            toolResults.push({
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: resultContent,
            });
          }

          // Feed tool results back to the model
          messages.push({
            role: "assistant",
            content: response.content as Anthropic.Messages.ContentBlockParam[],
          });
          messages.push({
            role: "user",
            content: toolResults,
          });

          response = await client.messages.create({
            model: MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: SYSTEM_PROMPT,
            tools: toolDefs as Anthropic.Messages.Tool[],
            messages,
          });
        }

        // Extract final text response
        const textBlocks = response.content.filter(
          (block): block is Anthropic.Messages.TextBlock =>
            block.type === "text",
        );
        const assistantText = textBlocks.map((b) => b.text).join("\n\n");

        // Persist assistant message
        await tx.insert(chatMessage).values({
          conversationId: convId,
          familyId,
          role: "assistant" as MessageRole,
          content: assistantText,
          toolCallsJson: allToolCalls.length > 0 ? allToolCalls : null,
        });

        // Update conversation timestamp + title (use first ~60 chars of
        // user message as title if this is the first message)
        const title =
          !conversationId
            ? content.slice(0, 60) + (content.length > 60 ? "..." : "")
            : undefined;

        await tx
          .update(chatConversation)
          .set({
            updatedAt: new Date(),
            ...(title ? { title } : {}),
          })
          .where(eq(chatConversation.id, convId));

        return {
          conversationId: convId,
          assistantMessage: assistantText,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        } satisfies ChatResult;
      },
    );

    revalidatePath("/chat");
    return { success: true, data: result };
  } catch (err) {
    console.error("[chat/sendMessage]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * List conversations for the current user, most recent first.
 */
export async function getConversations(): Promise<
  Array<{ id: string; title: string | null; updatedAt: Date }>
> {
  const { familyId, userId } = await getSessionContext();
  const db = getDb();

  return withFamilyContext(db, familyId, userId, async (tx) => {
    return tx
      .select({
        id: chatConversation.id,
        title: chatConversation.title,
        updatedAt: chatConversation.updatedAt,
      })
      .from(chatConversation)
      .where(
        and(
          eq(chatConversation.userId, userId),
          eq(chatConversation.familyId, familyId),
        ),
      )
      .orderBy(desc(chatConversation.updatedAt));
  });
}

/**
 * Load messages for a conversation, oldest first.
 */
export async function getMessages(
  targetConversationId: string,
): Promise<
  Array<{
    id: string;
    role: string;
    content: string;
    toolCallsJson: Array<Record<string, unknown>> | null;
    createdAt: Date;
  }>
> {
  const { familyId, userId } = await getSessionContext();
  const db = getDb();

  return withFamilyContext(db, familyId, userId, async (tx) => {
    return tx
      .select({
        id: chatMessage.id,
        role: chatMessage.role,
        content: chatMessage.content,
        toolCallsJson: chatMessage.toolCallsJson,
        createdAt: chatMessage.createdAt,
      })
      .from(chatMessage)
      .where(eq(chatMessage.conversationId, targetConversationId))
      .orderBy(asc(chatMessage.createdAt));
  });
}

/**
 * Delete a conversation and all its messages (cascade).
 */
export async function deleteConversation(
  targetConversationId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx
        .delete(chatConversation)
        .where(
          and(
            eq(chatConversation.id, targetConversationId),
            eq(chatConversation.userId, userId),
          ),
        );
    });

    revalidatePath("/chat");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert DB message rows into the Anthropic messages API shape. Tool
 * messages (role = 'tool') are skipped — tool calls/results are stored
 * inline in assistant messages via `toolCallsJson` and reconstructed
 * from history only if we ever need multi-turn tool replay. For now, we
 * keep the history simple: user and assistant text messages only.
 */
function buildAnthropicMessages(
  rows: Array<{
    role: string;
    content: string;
    toolCallsJson: Array<Record<string, unknown>> | null;
  }>,
): Anthropic.Messages.MessageParam[] {
  const messages: Anthropic.Messages.MessageParam[] = [];

  for (const row of rows) {
    if (row.role === "user") {
      messages.push({ role: "user", content: row.content });
    } else if (row.role === "assistant") {
      messages.push({ role: "assistant", content: row.content });
    }
    // 'tool' role rows are display-only (stored for UI); skip in API history
  }

  return messages;
}
