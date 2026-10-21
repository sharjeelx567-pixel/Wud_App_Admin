// Must match the backend's AdminRole exactly (backend/src/types/index.ts) —
// these are the only values ALLOWED_ADMIN_ROLES accepts on a role update.
export type AdminRole =
  | 'super_admin'
  | 'admin'
  | 'moderator'
  | 'verification_staff'
  | 'support_staff'
  | 'content_moderator'
  | 'analyst';

export type AdminPermission =
  | '*'
  | 'users.view'
  | 'users.manage'
  | 'profiles.view'
  | 'profiles.manage'
  | 'photos.view'
  | 'photos.approve'
  | 'photos.reject'
  | 'verification.view'
  | 'verification.approve'
  | 'verification.reject'
  | 'reports.view'
  | 'reports.manage'
  | 'support.view'
  | 'support.respond'
  | 'support.manage'
  | 'chat_moderation.view'
  | 'chat_moderation.manage'
  | 'connections.view'
  | 'subscriptions.view'
  | 'subscriptions.manage'
  | 'notifications.view'
  | 'notifications.send'
  | 'analytics.view'
  | 'audit_logs.view'
  | 'admins.view'
  | 'admins.create'
  | 'admins.update'
  | 'admins.disable'
  | 'admins.delete'
  | 'roles.view'
  | 'roles.manage'
  | 'content.view'
  | 'content.create'
  | 'content.update'
  | 'content.publish'
  | 'content.delete'
  | 'settings.view'
  | 'settings.manage'
  | 'posts.view'
  | 'posts.manage';

export const ALL_ADMIN_PERMISSIONS: AdminPermission[] = [
  'users.view',
  'users.manage',
  'profiles.view',
  'profiles.manage',
  'photos.view',
  'photos.approve',
  'photos.reject',
  'verification.view',
  'verification.approve',
  'verification.reject',
  'reports.view',
  'reports.manage',
  'support.view',
  'support.respond',
  'support.manage',
  'chat_moderation.view',
  'chat_moderation.manage',
  'connections.view',
  'subscriptions.view',
  'subscriptions.manage',
  'notifications.view',
  'notifications.send',
  'analytics.view',
  'audit_logs.view',
  'admins.view',
  'admins.create',
  'admins.update',
  'admins.disable',
  'admins.delete',
  'roles.view',
  'roles.manage',
  'content.view',
  'content.create',
  'content.update',
  'content.publish',
  'content.delete',
  'settings.view',
  'settings.manage',
  'posts.view',
  'posts.manage',
];

export interface Admin {
  uid: string;
  email: string;
  displayName: string;
  role: AdminRole;
  permissions?: AdminPermission[];
  effectivePermissions?: AdminPermission[];
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface NikkahUser {
  uid: string;
  email?: string;
  displayName?: string;
  phoneNumber?: string;
  gender?: string;
  profileImage?: string;
  pendingProfileImage?: string;
  city?: string;
  country?: string;
  profession?: string;
  educationLevel?: string;
  age?: number;
  maritalStatus?: string;
  bio?: string;
  profileCompleted?: boolean;
  profileStatus?: 'pending' | 'approved' | 'rejected';
  photoStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  photos?: string[];
  galleryImages?: string[];
  pendingGalleryImages?: string[];
  totalPhotoCount?: number;
  photoRejectionReason?: string;
  verificationStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  verificationDocType?: 'cnic' | 'passport' | 'video';
  verificationDocUrl?: string;
  verificationVideoUrl?: string;
  isPremium?: boolean;
  isVerified?: boolean;
  identityVerified?: boolean;
  genderVerified?: boolean;
  isBanned?: boolean;
  isSuspended?: boolean;
  banReason?: string;
  heightCm?: number;
  familyType?: string;
  sect?: string;
  ethnicity?: string;
  caste?: string;
  createdAt?: string;
  lastLoginAt?: string;
}

export interface UserImageEntry {
  url: string;
  isMain: boolean;
  order: number;
  status: 'pending' | 'approved';
  uploadedAt: string | null;
}

export interface UserPhotoDetail {
  uid: string;
  displayName?: string;
  email?: string;
  gender?: string;
  city?: string;
  photoStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  photoRejectionReason?: string;
  totalImages: number;
  maxImages: number;
  images: UserImageEntry[];
}

export interface Report {
  id: string;
  _collection?: "reports" | "support_tickets" | "post_reports";
  // Only present for _collection === "post_reports" — lets the UI link
  // straight to the reported rishta post / community post / community
  // comment.
  postId?: string;
  commentId?: string | null;
  contentType?: "rishta_post" | "community_post" | "community_comment";
  userId?: string;
  reporterId?: string;
  reporterUid?: string;
  reportedUserId?: string;
  reporter?: {
    uid?: string;
    displayName?: string;
    name?: string;
    email?: string;
    profileImage?: string;
    avatar?: string;
    gender?: string;
  };
  reportedUser?: {
    uid?: string;
    displayName?: string;
    name?: string;
    email?: string;
    profileImage?: string;
    avatar?: string;
    gender?: string;
  };
  reason?: string;
  userEmail?: string;
  userDisplayName?: string;
  category?: string;
  description?: string;
  status?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  targetId: string;
  targetType: 'user' | 'photo' | 'verification' | 'report' | 'setting' | 'admin' | 'legal_document' | 'notification';
  details: Record<string, any>;
  timestamp: string;
  ip: string;
}

export interface AppSettings {
  maintenanceMode: boolean;
  premiumMonthlyPrice: number;
  premiumYearlyPrice: number;
  maxPhotosPerUser: number;
  allowRegistration: boolean;
  requireEmailVerification: boolean;
  matchingEnabled: boolean;
  chatEnabled: boolean;
  maxMatchDistanceKm?: number;
  enforceGenderMatching?: boolean;
  featureFlags: Record<string, boolean>;
}

export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  todaySignups: number;
  premiumUsers: number;
  pendingVerifications: number;
  pendingPhotos: number;
  pendingReports: number;
  pendingRishtaPosts?: number;
  pendingCommunityPosts?: number;
  bannedUsers: number;
  totalRevenue?: number;
  recentActivity?: any[];
}


export interface LegalDocument {
  id: string;
  title: string;
  slug: string;
  content: string;
  publishedContent?: string;
  status: 'draft' | 'published' | 'unpublished' | 'archived';
  version: number;
  publishedVersion?: number;
  summary?: string;
  updatedBy: string;
  createdAt: any;
  updatedAt: any;
  publishedAt?: any;
}

export interface LegalDocumentVersion {
  id?: string;
  version: number;
  publishedVersion?: number;
  title: string;
  content: string;
  status: 'draft' | 'published' | 'unpublished' | 'archived';
  changeLog?: string;
  createdBy: string;
  createdAt: any;
}
