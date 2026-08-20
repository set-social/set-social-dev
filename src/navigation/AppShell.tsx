import React, { useState } from 'react';
import { View } from 'react-native';
import { MainTabs } from './MainTabs';
import { PostFab } from './PostFab';
import type { MainTabParamList } from './types';

/**
 * Main tabs + the Social tab's own "+" post FAB layered on top of just its
 * feed screen. Arnold used to be a second globally-reachable affordance
 * here (ChatEdgeTab, an edge-docked sliver) — now that it has a permanent
 * center slot in the tab bar itself (see MainTabs/ArnoldTabButton), there's
 * nothing left for AppShell to layer on any other tab.
 */
export function AppShell() {
  const [activeTab, setActiveTab] = useState<keyof MainTabParamList>('TodayTab');
  const [focusedScreen, setFocusedScreen] = useState<string | undefined>(undefined);

  const handleActiveTabChange = (tabName: keyof MainTabParamList, focusedScreenName?: string) => {
    setActiveTab(tabName);
    setFocusedScreen(focusedScreenName);
  };

  const isCommunityTab = activeTab === 'CommunityTab';
  const showPostFab = isCommunityTab && (focusedScreen === undefined || focusedScreen === 'Posts');

  return (
    <View style={{ flex: 1 }}>
      <MainTabs onActiveTabChange={handleActiveTabChange} />
      {showPostFab ? <PostFab /> : null}
    </View>
  );
}
