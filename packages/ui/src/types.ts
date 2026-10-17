import type { Component } from 'vue';

/** A tag name or a component (e.g. RouterLink) to render as the root element. */
export type AsProp = string | Component;

export type BohrButtonSize = 'sm' | 'md' | 'lg';
export type BohrButtonVariant = 'default' | 'ghost' | 'text';
export type BohrButtonColor = 'primary' | 'secondary' | 'tertiary' | 'black';

export type BohrBoxVariant = 'outline' | 'glass' | 'outline-danger' | 'outline-highlight';
export type BohrBoxColor = 'orange' | 'green' | 'purple' | 'red';

export type ValidationStatus = '' | 'error' | 'warn' | 'success';

export type DeployStatus = 'success' | 'warning' | 'error' | 'off';

export type SitePreviewDevice = 'desktop' | 'tabletPortrait' | 'tabletLandscape' | 'phonePortrait' | 'phoneLandscape';

/** Ring colors of the avatar wall, from the v1 plan badges. */
export type AvatarRing = 'green' | 'pink' | 'fire' | 'steel';

export interface AvatarWallPerson {
  name: string;
  avatarUrl: string;
  href?: string;
  ring?: AvatarRing;
}

export interface DeployCardLabels {
  updated: string;
  by: string;
  hash: string;
  viewLogs: string;
  viewProject: string;
}
