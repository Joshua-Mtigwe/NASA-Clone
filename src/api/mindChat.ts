/**
 * Client for the AEGIS Mind Companion service. Every reply comes from the model on
 * the mission server; nothing here generates or substitutes text.
 */
import { mindChatOrigin } from '@/config/env';
import { callEndpoint } from './client';

export type ChatGenerationStatus = 'received' | 'completed' | 'failed' | 'withheld';

export interface ChatMessage {
  message_id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model_id: string | null;
  generation_status: ChatGenerationStatus;
  sync_status: 'synced';
  client_message_id: string | null;
  reply_to: string | null;
  support_notice: boolean;
}

export interface ChatConversation {
  conversation_id: string;
  astronaut_id: string;
  created_at: string;
  updated_at: string;
  status: 'active';
  message_count: number;
  /** First astronaut message, truncated. */
  preview: string | null;
}

export interface ChatConversationDetail {
  conversation: ChatConversation;
  messages: ChatMessage[];
}

export interface SendMessageResponse {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
  /** Fixed AEGIS text (not model output) shown when a message may describe a risk of harm. */
  support_notice: string | null;
  prompt_version: string;
}

export interface MindChatStatus {
  service: string;
  model_configured: boolean;
  model: string;
  model_api: string;
  demo_auth: boolean;
  prompt_version: string;
  /** Fixed AEGIS support text for messages flagged as a possible risk of harm. */
  support_notice: string;
}

const init = { origin: mindChatOrigin || undefined };

export const mindChatApi = {
  status: () => callEndpoint<MindChatStatus>('mindChat.status', {}, init),
  list: () => callEndpoint<ChatConversation[]>('mindChat.listConversations', {}, init),
  create: () =>
    callEndpoint<ChatConversation>('mindChat.createConversation', {}, { ...init, body: {} }),
  get: (conversationId: string) =>
    callEndpoint<ChatConversationDetail>('mindChat.getConversation', { conversationId }, init),
  remove: (conversationId: string) =>
    callEndpoint<void>('mindChat.deleteConversation', { conversationId }, init),
  send: (
    conversationId: string,
    body: { content: string; client_message_id: string; mission_day?: number },
  ) =>
    callEndpoint<SendMessageResponse>(
      'mindChat.sendMessage',
      { conversationId },
      { ...init, body },
    ),
};
