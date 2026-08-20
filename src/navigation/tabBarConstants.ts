/** Shared between MainTabs and ArnoldTabButton — kept in its own module (not
 * exported from MainTabs.tsx directly) so ArnoldTabButton can depend on it
 * without a circular import, since MainTabs.tsx itself imports
 * ArnoldTabButton. */
export const TAB_ICON_SIZE = 18;
