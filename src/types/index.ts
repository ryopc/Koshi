// ============================================
// koshi Platform Types - クライアント開発者向け公開型
// import { DM, Group, WSMessage, ... } from '@ryopc/koshi/types'
// ============================================

// --- 共通 ---
export interface User {
  id: string;
  username: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface ApiError {
  error: string;
  message?: string;
}

// --- DM (既存拡張) ---
export interface DM {
  id: string;
  from: User;
  to: User;
  content: string;
  signature: string;
  isRead: boolean;
  createdAt: string;
}

export interface SendDMRequest {
  content: string;
  signature: string;  // ed25519 signature of content (hex, 128 chars)
}

export interface DMListParams {
  limit?: number;     // default 50, max 100
  offset?: number;    // default 0
  unread?: boolean;   // default false
}

// --- グループ (新規) ---
export type GroupRole = 'admin' | 'member';

export interface Group {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  createdBy: string;      // userId
  isE2EE: boolean;        // 常に true (Pito要件)
  createdAt: string;
  updatedAt: string;
  memberCount?: number;   // 一覧API用
  myRole?: GroupRole;     // 一覧API用
}

export interface GroupMember {
  id: string;             // group_members.id
  groupId: string;
  user: User;
  role: GroupRole;
  joinedAt: string;
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
  memberUserIds: string[];  // 作成者含む
  avatarUrl?: string;
}

export interface UpdateGroupRequest {
  name?: string;
  description?: string;
  avatarUrl?: string;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  sender: User;
  content: string;        // 暗号化済み (E2E)
  signature: string;      // ed25519 signature
  messageType: 'text' | 'image' | 'file' | 'system';
  replyTo?: string;       // group_messages.id
  createdAt: string;
}

export interface SendGroupMessageRequest {
  content: string;
  signature: string;
  messageType?: 'text' | 'image' | 'file';
  replyTo?: string;
}

export interface GroupMessagesParams {
  limit?: number;    // default 50, max 100
  offset?: number;   // default 0
  before?: string;   // message ID (cursor pagination)
}

// --- E2E / デバイス / 鍵 (新規) ---
export interface Device {
  id: string;
  userId: string;
  deviceName?: string;
  identityKey: string;      // X25519 public key (base64)
  signedPreKey: string;     // X25519 public key (base64)
  preKeySignature: string;  // ed25519 signature of signedPreKey (base64)
  oneTimePreKeys: string[]; // X25519 public keys (base64)
  createdAt: string;
  lastSeenAt?: string;
}

export interface RegisterDeviceRequest {
  deviceName?: string;
  identityKey: string;
  signedPreKey: string;
  preKeySignature: string;
  oneTimePreKeys: string[];
}

export interface KeyBundle {
  identityKey: string;
  signedPreKey: string;
  preKeySignature: string;
  oneTimePreKeys: string[];
}

// --- WebSocket イベント ---
export type WSMessageType =
  // 認証・接続
  | 'connected' | 'error' | 'pong'
  // 投稿
  | 'post_created'
  // DM
  | 'dm_received' | 'dm_sent' | 'dm_read'
  // グループ
  | 'group_created' | 'group_updated' | 'group_deleted'
  | 'group_member_added' | 'group_member_removed'
  | 'group_message' | 'group_message_read'
  // 入力中
  | 'typing_start' | 'typing_stop'
  // 鍵交換
  | 'key_bundle_request' | 'key_bundle_response';

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  payload: T;
}

export interface WSEventMap {
  connected: { userId: string; username: string; message: string };
  error: { message: string };
  pong: { timestamp: string };
  post_created: PostEvent;
  dm_received: DMEvent;
  dm_sent: DMEvent;
  dm_read: { dmId: string; readAt: string };
  group_created: { group: Group; members: GroupMember[] };
  group_updated: { groupId: string; changes: Partial<Group> };
  group_deleted: { groupId: string };
  group_member_added: { groupId: string; member: GroupMember; addedBy: string };
  group_member_removed: { groupId: string; userId: string; removedBy: string };
  group_message: { message: GroupMessage; groupId: string };
  group_message_read: { groupId: string; messageId: string; userId: string; readAt: string };
  typing_start: { conversationId: string; conversationType: 'dm' | 'group'; userId: string; username: string };
  typing_stop: { conversationId: string; conversationType: 'dm' | 'group'; userId: string; username: string };
  key_bundle_request: { targetUserId: string };
  key_bundle_response: { userId: string; bundle: KeyBundle };
}

export interface PostEvent {
  id: string;
  author: User;
  content: string;
  signature: string;
  timestamp: string;
}

export interface DMEvent {
  id: string;
  from: { id: string; username: string };
  content: string;
  signature: string;
  timestamp: string;
}