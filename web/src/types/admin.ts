// Shared types for the Admin control room.

export interface AdminResource {
  id: number;
  title: string;
  description: string;
  category: string;
  tags: string;
  imageUrl: string;
  fileUrl: string;
  panCode?: string | null;
  downloadCount: number;
  createdAt: string;
  resType?: string | null;
  license?: string | null;
  language?: string | null;
  isFree?: number | null;
  /** Per-software tag group + optional render-engine override (the admin
      edit form reads renderEngine from here and hoists it into the form). */
  tagGroups?: {
    software?: string[];
    element?: string[];
    technique?: string[];
    renderEngine?: string;
  } | null;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string | null;
  role: string;
  createdAt: string;
}

export interface AdminInvite {
  id: number;
  code: string;
  createdAt: string;
  usedAt: string | null;
  usedBy: number | null;
  createdByName: string | null;
  usedByName: string | null;
}

export const ADMIN_TAG_POOLS = {
  software: ['Houdini', 'Unreal Engine', 'Blender', 'Maya', '3ds Max', 'Cinema 4D', 'Substance'],
  element: [
    'sand', 'water', 'fire', 'smoke', 'foliage', 'rocks',
    'glass', 'metal', 'fabric', 'wood', 'ice', 'cloud',
    'fog', 'city', 'characters', 'vehicles',
  ],
  technique: [
    'procedural', 'fx', 'simulation', 'shader', 'geometry', 'vfx',
    'modeling', 'rigging', 'animation', 'lighting', 'particles',
    'destruction', 'fluids', 'cloth', 'hair', 'rendering',
  ],
} as const;

export type AdminTagCategory = keyof typeof ADMIN_TAG_POOLS;

export const ADMIN_CATEGORIES = ['Houdini', 'UE', 'Blender'] as const;

// ─── Taxonomy (资源分类体系) ─────────────────────────────────────────────
// Canonical keys shared with the API (api/server.ts validates the same
// sets). Labels live in the i18n dictionaries (resourceType.*, license.*,
// language.*).
export const ADMIN_RESOURCE_TYPES = [
  'plugin', 'preset', 'material', 'model', 'project', 'tutorial', 'aiworkflow', 'audio',
] as const;
export type AdminResourceType = (typeof ADMIN_RESOURCE_TYPES)[number];

export const ADMIN_LICENSES = ['cc0', 'mit', 'gpl', 'commercial'] as const;
export type AdminLicense = (typeof ADMIN_LICENSES)[number];

export const ADMIN_LANGUAGES = ['zh', 'en', 'localized'] as const;
export type AdminLanguage = (typeof ADMIN_LANGUAGES)[number];

export interface AdminResourceForm {
  title: string;
  description: string;
  category: string;
  tags: string;
  imageUrl: string;
  fileUrl: string;
  panCode: string;
  renderEngine: string;
  resType: string;
  license: string;
  language: string;
  isFree: boolean;
  tagGroups: { software: string[]; element: string[]; technique: string[]; renderEngine?: string };
}

export const EMPTY_ADMIN_RESOURCE_FORM: AdminResourceForm = {
  title: '',
  description: '',
  category: 'Houdini',
  tags: '',
  imageUrl: '',
  fileUrl: '',
  panCode: '',
  renderEngine: '',
  resType: '',
  license: '',
  language: '',
  isFree: true,
  tagGroups: { software: [], element: [], technique: [] },
};
