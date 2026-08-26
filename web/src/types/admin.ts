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
  tagGroups?: { software?: string[]; element?: string[]; technique?: string[] } | null;
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

export interface AdminResourceForm {
  title: string;
  description: string;
  category: string;
  tags: string;
  imageUrl: string;
  fileUrl: string;
  panCode: string;
  renderEngine: string;
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
  tagGroups: { software: [], element: [], technique: [] },
};
