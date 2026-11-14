/**
 * Conversation persistence: one JSON file, written atomically (temp file + rename)
 * and serialised so concurrent requests cannot interleave writes. Message content
 * is stored here only; it is never written to logs.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type MessageRole = 'user' | 'assistant';

/**
 * user: `received` (awaiting a reply) -> `completed` (answered) or `failed` (the
 * model was unavailable; retry with the same client_message_id).
 * assistant: `completed`, or `withheld` (blocked by the safety check; content empty).
 */
export type GenerationStatus = 'received' | 'completed' | 'failed' | 'withheld';

export interface Conversation {
  conversation_id: string;
  astronaut_id: string;
  created_at: string;
  updated_at: string;
  status: 'active';
}

export interface Message {
  message_id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  model_id: string | null;
  generation_status: GenerationStatus;
  /** Stored on the mission server; the browser does not keep its own copy. */
  sync_status: 'synced';
  /** Client-generated id that makes sending idempotent. User messages only. */
  client_message_id: string | null;
  /** For assistant messages: the user message answered. */
  reply_to: string | null;
  /** True when the safety layer flagged the user message as a possible risk of harm. */
  support_notice: boolean;
}

interface StoreFile {
  version: 1;
  conversations: Conversation[];
  messages: Message[];
}

export class ConversationStore {
  private data: StoreFile = { version: 1, conversations: [], messages: [] };
  private writing: Promise<void> = Promise.resolve();

  private constructor(private readonly file: string) {}

  static async open(file: string): Promise<ConversationStore> {
    const store = new ConversationStore(file);
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as StoreFile;
      if (parsed.version === 1 && Array.isArray(parsed.conversations)) store.data = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data);
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, this.file);
    });
    return this.writing;
  }

  listConversations(astronautId: string): Conversation[] {
    return this.data.conversations
      .filter((c) => c.astronaut_id === astronautId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  getConversation(id: string): Conversation | null {
    return this.data.conversations.find((c) => c.conversation_id === id) ?? null;
  }

  messages(conversationId: string): Message[] {
    return this.data.messages
      .filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || (a.role === 'user' ? -1 : 1));
  }

  findByClientId(conversationId: string, clientId: string): Message | null {
    return (
      this.data.messages.find(
        (m) => m.conversation_id === conversationId && m.client_message_id === clientId,
      ) ?? null
    );
  }

  replyTo(messageId: string): Message | null {
    return this.data.messages.find((m) => m.reply_to === messageId) ?? null;
  }

  async createConversation(astronautId: string, now: string): Promise<Conversation> {
    const c: Conversation = {
      conversation_id: `MCC-${randomUUID()}`,
      astronaut_id: astronautId,
      created_at: now,
      updated_at: now,
      status: 'active',
    };
    this.data.conversations.push(c);
    await this.persist();
    return c;
  }

  async addMessage(m: Omit<Message, 'message_id' | 'sync_status'>): Promise<Message> {
    const message: Message = { ...m, message_id: `MCM-${randomUUID()}`, sync_status: 'synced' };
    this.data.messages.push(message);
    const c = this.getConversation(m.conversation_id);
    if (c) c.updated_at = m.timestamp;
    await this.persist();
    return message;
  }

  async updateMessage(id: string, patch: Partial<Pick<Message, 'generation_status'>>) {
    const m = this.data.messages.find((x) => x.message_id === id);
    if (m) Object.assign(m, patch);
    await this.persist();
    return m ?? null;
  }

  /** Permanently removes a conversation and all its messages. */
  async deleteConversation(id: string): Promise<void> {
    this.data.conversations = this.data.conversations.filter((c) => c.conversation_id !== id);
    this.data.messages = this.data.messages.filter((m) => m.conversation_id !== id);
    await this.persist();
  }

  /** Waits for pending writes (tests, shutdown). */
  flush(): Promise<void> {
    return this.writing;
  }
}
